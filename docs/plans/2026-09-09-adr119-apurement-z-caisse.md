# Plan : ADR-119 — apurement automatique des factures de synthèse e-Reporting B2C

## Contexte projet

Le réacteur de consolidation e-Reporting (ADR-107, tranche 3) émet des Z de caisse
par le chemin d'émission légal, `InvoicesService.issue()`. Celui-ci pose
`amountDue = totalTtc` et `status = issued` — la seule chose sensée pour une
facture de commerce, et la mauvaise pour un Z.

Un Z de caisse consolide des micro-ventes **déjà réglées au comptoir**, en espèces
ou en Mobile Money, avant même que le document n'existe. Émis comme une créance :

1. le poste clients du tableau de bord gonfle d'un montant que personne ne doit ;
2. `issue()` génère un lien de paiement si `paymentLinkAutoSend` est vrai — un
   lien fantôme vers un client final qui a déjà payé et ne reconnaîtrait ni le
   montant global ni le document.

## Numérotation de l'ADR

L'énoncé d'origine portait le numéro **109**. Il était déjà pris : « alignement
EN 16931 / champs B2G structurés » (Lot C), référencé dans `create-invoice.dto.ts`,
`untdid.ts`, `invoices.service.ts`, `create-pdp-invoice.dto.ts` et le schéma.
Décision retenue : **ADR-119**, premier numéro libre (108→118 et 120 sont en
service).

## Clarifications — trois écarts entre l'énoncé et le schéma

**1. `saisieRegime = 'HT_FIRST'` n'est PAS un discriminant, et le prendre pour
tel effacerait du chiffre d'affaires réel.**

L'énoncé conditionne l'apurement à « `saisieRegime = 'HT_FIRST'` **et** rattaché
à un lot e-Reporting consolidé ». La conjonction est correcte ; la première
clause prise seule serait catastrophique. `PdpConsolidationService.creerBrouillonLie()`
pose `HT_FIRST` sur **toute** ligne de facture B2B/B2G déposée par un ERP tiers
(c'est le standard des ERP : prix unitaires HT). Ce sont de vraies créances
impayées, et les apurer d'office effacerait des dizaines de millions de GNF de dû.

Dans ce schéma, les deux clauses désignent le même ensemble. Une seule est
**sûre** : c'est donc elle, et elle seule, qui est encodée — le rattachement au
lot, porté par `invoice.reportingSeriesNumber`, écrit exclusivement par
`ouvrirOuReprendreLot()` dans la transaction qui crée le brouillon Z.

**2. Le prédicat n'est pas `!== null`.**

`undefined !== null` vaut `true`. Une facture lue par un `select` n'incluant pas
la colonne serait reconnue comme Z de caisse : apurée d'office, créditée d'un
règlement fantôme, privée de lien de paiement. Une créance effacée ne se rattrape
pas — le défaut doit tomber du côté « ce n'est pas un Z ». D'où
`estSyntheseDeCaisse()`, qui teste la **présence d'une chaîne non vide**.

**3. `invoice_ledger` n'existe pas, et `paymentLinkAutoSend` n'est pas sur la
facture.**

L'énoncé propose « table `payment` ou `invoice_ledger` » : seule `payment` existe.

Et `payment_link_auto_send` est une colonne d'**`Organization`**. La « forcer à
`false` » couperait les liens de paiement de TOUTES les factures du marchand, y
compris ses ventes B2B à recouvrer — une régression de recouvrement silencieuse,
déclenchée par le premier Z venu et jamais rétablie. Le court-circuit est donc
posé **sur le document**, dans `issue()`, et la colonne du marchand reste ce
qu'il en a décidé.

## Décision d'implémentation

Dans la transaction de certification d'`issue()`, si `estSyntheseDeCaisse(invoice)` :

| | Facture ordinaire | Z de caisse |
|---|---|---|
| `status` | `issued` | `paid` |
| `amountDue` | `totalTtc` | `BigInt(0)` |
| `amountPaid` | inchangé | `totalTtc` |
| `payment` | — | 1 règlement `cash` / `completed` |
| lien de paiement | selon l'organisation | jamais |
| transmission e-TVA | oui | **oui** |

Le règlement commite **avec** la certification : un Z certifié sans son règlement
serait une créance fantôme, un règlement sans son Z un encaissement orphelin.

`idempotencyKey = zr-apurement-<invoiceId>` — la colonne `@unique` (ADR-016) rend
l'idempotence gratuite : un rejeu heurte la contrainte au lieu de créditer deux fois.

Le statut `paid` ferme aussi le second encaissement sans garde supplémentaire :
`PAYABLE_STATUSES` (PaymentsService) n'admet que `issued` et `partially_paid`.

### `method: "cash"` — et sa contrepartie obligatoire

Un Z de caisse se solde au journal de caisse, comme son équivalent papier :
l'export FEC lit cette colonne (`fec-generation.ts` → compte 5310, journal « CA »).
La part réellement encaissée en Mobile Money y va donc aussi — le connecteur ERP
ne transmet **aucun mode de règlement par ticket**, et inventer une ventilation
serait pire que l'assumer.

**Contrepartie non négociable** : ces règlements sont exclus du ratio non-cash du
détecteur de contournement de commission (`PaymentsService.computeNonCashRatio`,
G3/ADR-091). Le cron tourne toutes les heures : sans exclusion, ~24 règlements
`cash` par jour et par marchand à caisse entreraient au dénominateur, le ratio
s'effondrerait mécaniquement, et « chute du ratio non-cash » est précisément le
motif d'ouverture d'un `CommissionBypassCase`. Un commerçant honnête, dont le seul
tort est d'avoir branché sa caisse, partirait en revue Squad Money.

L'exclusion porte sur les **deux** comptages, pas seulement le dénominateur : ces
règlements sont `cash` aujourd'hui, mais un filtre posé d'un seul côté deviendrait
faux le jour où le connecteur transmettrait un mode par ticket.

## Fichiers

| Fichier | Nature |
|---|---|
| `apps/trust-api/src/invoices/invoices.service.ts` | `estSyntheseDeCaisse()`, apurement dans `issue()`, court-circuit du lien |
| `apps/trust-api/src/payments/payments.service.ts` | exclusion du ratio non-cash |
| `apps/trust-api/src/invoices/invoices.service.spec.ts` | 8 tests, dont 3 gardes de non-régression sur les créances réelles |
| `apps/trust-api/src/payments/payments.service.spec.ts` | garde d'exclusion du ratio |
| `apps/trust-api/src/pdp/pdp-reporting-consolidation.integration.spec.ts` | apurement vérifié en base réelle |

## Ce que la décision ne fait PAS

- **Aucune migration.** Toutes les colonnes existent.
- **Aucune ventilation espèces / Mobile Money.** Elle exigerait un mode de
  règlement par ticket dans le contrat PDP — extension du contrat connecteur,
  hors sujet ici.
- **Aucun rattrapage des Z déjà émis.** Aucun n'existe en production : le cron est
  en opt-in et n'a jamais été armé.
