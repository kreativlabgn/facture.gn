# Plan : Réacteur de consolidation e-Reporting B2C (ADR-107/108, LFI 2025)

## Contexte projet

La passerelle PDP (ADR-107) est ouverte depuis deux tranches. Elle accepte les
dépôts des ERP tiers (Odoo, OwoDesk) et les aiguille sur `PdpRawTransaction.flow` :

- `e_invoicing` (B2B/B2G) — un job BullMQ par document, `PdpConsolidationService.consolidateUnitary()`
  crée la facture, l'émet via `InvoicesService.issue()`, bascule la ligne en `certified` ;
- `e_reporting` (B2C, caisses) — **rien**. Les lignes s'accumulent en `pending`.
  `PdpProcessor` porte une branche `ETAX_REPORTING_PERIODIC` qui ne fait explicitement
  rien, et `pdp.constants.ts` décrit la constante comme un « NOM RÉSERVÉ, SANS
  PRODUCTEUR À CE JOUR ».

Cette tranche écrit le consommateur manquant : le cron de regroupement qui compile
les micro-ventes de caisse en un Z de caisse unique, certifié, transmis à la DGI.

## Clarifications — ce que le cahier demandait et ce que le schéma permet

Quatre écarts entre l'énoncé et la base réelle, tous tranchés avant le code.

**1. Les noms d'enum de l'énoncé n'existent pas.** L'énoncé parle de
`flowType === 'ETAX_REPORTING_PERIODIC'` et `status === 'PENDING'` → `CONSOLIDATED`.
Le schéma porte `flow: PdpFlow` (`e_invoicing` | `e_reporting`) et
`status: PdpTransactionStatus` (`pending` | `certified` | `failed`).
`ETAX_REPORTING_PERIODIC` est un **nom de job BullMQ**, pas une valeur de colonne.

`certified` est retenu pour l'état final, et non une valeur `consolidated`
nouvelle : le commentaire de l'enum le définit déjà comme « facture émise et
certifiée (e-invoicing) **ou ligne intégrée à un Z de caisse (e-reporting)** ».
Inventer un synonyme aurait coûté une migration d'enum pour rien.

**2. `PdpRawTransaction.invoiceId` est `@unique` — il ne peut pas porter le lot.**
La colonne est l'ancre d'idempotence du worker unitaire (« une facture ne répond
que d'UN document ERP », documenté dans le schéma et garanti par
`pdp_raw_transaction_invoice_id_key`). Y accrocher les 50 micro-lignes d'un même Z
violerait la contrainte dès la deuxième.

→ **Colonne nouvelle `consolidated_invoice_id`**, FK vers `invoice`, NON unique,
indexée. `invoice_id` reste intact et `@unique` pour l'e-invoicing. Additif :
aucune contrainte existante n'est retirée.

**3. « Numéro de série dédié au e-Reporting » vs `InvoicesService.issue()`.**
`issue()` appelle `InvoiceNumberingService.nextNumber()`, séquence UNIQUE par
(organisation, année), « sans trou » — Article 23 OHADA. Il n'existe aucune notion
de série, et forker cette séquence est une décision juridique, pas technique.

→ Les deux, sans toucher au chemin légal : le Z prend son numéro légal
`FG-YYYY-NNNNNN` par `issue()`, **et** un numéro de série e-Reporting dédié
`ZR-YYYY-NNNNNN` issu d'un compteur séparé (`pdp_reporting_sequence`), posé sur
`invoice.reporting_series_number`. Même upsert atomique `ON CONFLICT DO UPDATE`
que `invoice_sequence`, et même discipline du `tx` explicite — un numéro consommé
hors de la transaction serait un trou irréversible dans la série.

**4. `saisieRegime` vit sur `InvoiceLine`, pas sur `Invoice`.** L'énoncé demande le
flag « dans la table `Invoice` ». La colonne ADR-108 est sur `invoice_line`
(`saisie_regime`, défaut `TTC_FIRST`) — c'est un indicateur de PROVENANCE du prix
unitaire, sans effet sur les montants. Le `HT_FIRST` est donc posé sur la ligne de
synthèse, exactement comme `creerBrouillonLie()` le fait déjà pour l'e-invoicing.

## Architecture

### Pourquoi trois transactions et pas une

`InvoicesService.issue()` **ouvre sa propre transaction**. Envelopper la sélection
verrouillée et l'émission dans un seul `$transaction` est impossible : ce serait
une transaction imbriquée. Le découpage est donc imposé, et chaque coupure est un
point de reprise :

| | Travail | Reprise si crash juste après |
|---|---|---|
| TX-A | scope RLS → `SELECT … FOR UPDATE` des lignes `pending` → somme BigInt → brouillon Z + ligne de synthèse → `consolidated_invoice_id` posé sur les lignes → n° `ZR` | lignes `pending` + `consolidated_invoice_id` non nul → le run suivant REPREND ce Z, n'en crée pas un second |
| TX-B | `issue()` — n° Article 23, certification Ed25519, chaînage, enfilement e-TVA | Z `issued`, lignes encore `pending` → le run suivant relit le Z déjà émis et reprend SA certification |
| TX-C | scope RLS → lignes → `certified` + `certification_id` + `processed_at` | rien à reprendre |

**`consolidated_invoice_id` est posé sur le BROUILLON, en TX-A**, jamais à la
certification — même raisonnement que l'ancre d'idempotence du worker unitaire.
La sélection l'exclut (`consolidated_invoice_id IS NULL`) : deux runs concurrents
sur la même organisation ne peuvent donc pas embarquer les mêmes tickets.

### Le verrou

`SELECT id FROM pdp_raw_transaction … FOR UPDATE` en SQL brut, avec les littéraux
d'enum castés explicitement (`'e_reporting'::"PdpFlow"`) — un paramètre Prisma
arrive en `text` et Postgres refuse `PdpFlow = text`. `organization_id` reste
paramétré. `ORDER BY received_at, id` : deux runs concurrents prennent les lignes
dans le même ordre, jamais en ordre croisé.

Le verrou porte AUSSI le filtre organisation, comme dans `issue()` : sous RLS
appliqué la politique le ferait, mais tant qu'elle dort ce SQL brut verrouillerait
sinon les tickets d'un autre locataire.

### Le cron, en éventail

`ETAX_REPORTING_CONSOLIDATION_CRON` est armé par `PdpModule.onModuleInit()`
(`upsertJobScheduler`, même patron que `MerkleAnchorModule`), opt-in par
`PDP_REPORTING_ENABLED`, jamais bloquant au démarrage.

Il ne consolide rien lui-même : il ÉNUMÈRE les organisations à traiter et pose un
job `ETAX_REPORTING_PERIODIC` par organisation — le nom que `PdpProcessor`
reconnaît déjà. Un lot Odoo qui échoue chez une PME ne fait plus attendre les 400
autres, et chaque organisation garde son propre budget de réessais.

« Organisations actives » = celles qui ont réellement des lignes à compiler
(`flow='e_reporting' AND status='pending'`), lu sur l'index
`(organization_id, flow, status)` qui existe pour ça. Jamais un scan de la table
`organization` : il n'existe aucune colonne « active » sur ce modèle, et balayer
tous les locataires pour n'en retenir qu'une poignée coûterait plus cher que le
travail lui-même.

## Fichiers

| Fichier | Nature |
|---|---|
| `packages/db/prisma/schema.prisma` | `consolidated_invoice_id`, `reporting_series_number`, `PdpReportingSequence` |
| `packages/db/prisma/migrations/20260909030000_pdp_reporting_consolidation/` | DDL manuel + RLS de la nouvelle table |
| `apps/trust-api/src/pdp/pdp-reporting-numbering.service.ts` | compteur `ZR-YYYY-NNNNNN` |
| `apps/trust-api/src/pdp/pdp-consolidation.service.ts` | `consolidatePeriodicReporting()`, `listOrganizationsWithPendingReporting()` |
| `apps/trust-api/src/pdp/pdp.constants.ts` | `ETAX_REPORTING_CONSOLIDATION_CRON`, cadence, plafond de lot |
| `apps/trust-api/src/pdp/pdp.processor.ts` | branche cron (éventail) + branche périodique (travail réel) |
| `apps/trust-api/src/pdp/pdp.module.ts` | armement du scheduler, providers, métriques |
| `apps/trust-api/src/pdp/pdp-reporting-consolidation.integration.spec.ts` | 50 micro-factures → 1 Z, au centime |

## Ce que la tranche ne fait PAS

- **Aucune période calendaire.** Le lot est « tout ce qui est en attente à
  l'instant du run », pas « les ventes du jour J ». Découper par journée fiscale
  demande de trancher le fuseau de référence et la clôture de caisse — hors sujet
  ici, et le plafond de lot suffit à protéger le guichet.
- **Aucun appel synchrone au guichet DGI.** `issue()` enfile déjà la transmission
  unitaire (`ETAX_INVOICE_JOB`). Un second appel synchrone mettrait les deux
  chemins en course sur le même document — la transmission est asynchrone par
  construction, comme pour l'e-invoicing.
