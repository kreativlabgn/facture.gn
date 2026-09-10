# Plan : Barrière d'éligibilité au refinancement — serveur et écran (ADR-121)

> **Numérotation.** Le lot a été commandé sous « ADR-118 ». Ce numéro est pris :
> il désigne la Vague 3 et sa série `e1`…`e5` (registre Merkle, droits des
> personnes, rotation de clé, rapprochement bancaire, PWA offline-first),
> référencé quinze fois dans le dépôt. ADR-119 (apurement des Z de caisse) et
> ADR-120 (hébergement) sont pris également. Le premier libre est **121** ; la
> décision elle-même est inchangée. ADR complet :
> `docs/architecture/adr-121-financing-eligibility-barrier.md`.

## Contexte projet

- Modules : `apps/trust-api` (prédicat + garde transactionnelle) et `apps/web`
  (cohérence de l'écran d'arbitrage marchand). Aucune migration, aucun champ
  ajouté — la règle se durcit sur des colonnes qui existent déjà.
- Persona affecté : la PME qui cède sa créance (`owner` / `admin`), et le
  partenaire financier au bout du rail A (*Akiba Finance*). Le DAF n'est pas
  concerné : il vise la liquidation, il ne choisit jamais le rail.
- Données sensibles : montants de créances B2G et identité du cessionnaire.
  Aucune PII citoyen.
- Impact réglementaire : aucun texte fiscal. L'enjeu est le double
  encaissement — un partenaire rachetant une créance déjà réglée par le Trésor.

## Problème (en 3 lignes max)

`is_financeable()` n'excluait que `voided`. Une facture B2G visée par
l'administration **puis réglée** restait finançable côté serveur, et l'API
répondait 200. L'écran de la PME la masquait déjà, mais un masquage d'interface
n'est pas une garde : n'importe quel appel direct passait.

## Solution retenue (en 5 lignes max)

Le statut devient une **liste en positif** (`STATUTS_FINANCABLES = ["issued"]`),
et le litige une condition à part entière, lue sur `disputeStatus`.
`financeableInvoiceWhere()` suit à l'identique, si bien qu'un règlement tombant
entre la lecture et le commit fait échouer la revendication. Le refus est nommé :
`412` avec un code métier, distinct du `409 déjà financée`. Côté web, l'écran
cesse de proposer un geste que le serveur refuse désormais.

## Alternatives écartées

- **Une liste d'exclusions (`status !== "paid" && …`)** — écartée. C'est la forme
  d'origine, et c'est elle qui a créé le trou : tout statut ajouté plus tard à
  l'enum `InvoiceStatus` redevient finançable par défaut. La liste en positif
  inverse la charge — il faut inscrire un statut pour qu'il devienne cessible.
  Même discipline que `payment-eligibility.ts` côté money-api.
- **Traiter `DISPUTED` comme un statut** — impossible : le litige vit dans
  `Invoice.disputeStatus` (`none | disputed | resolved`), champ **séparé** de
  `status`. Une facture peut être `issued` ET `disputed`. L'ajouter à la liste
  des statuts aurait produit une valeur qu'aucune comparaison n'atteint — un
  correctif qui se lit bien et ne ferme rien. Le même piège existait côté web.
- **Exiger un statut `APPROVED`** — il n'existe pas. La validation par
  l'ordonnateur est le booléen `validatedByAdministration`, posé par
  `PublicBuyerPortalService.validateLiquidation()`, et déjà première condition
  du composite depuis ADR-080.
- **Admettre `PARTIALLY_PAID`** — écartée tant que le décaissement est tracé à
  `invoice.totalTtc`. Financer la valeur faciale d'une créance déjà amortie par
  tranches rachèterait une seconde fois la part encaissée. Rouvrir ce statut
  suppose d'abord de financer `amountDue` : autre chantier, autre ADR.
- **Un seul code d'erreur `409`** — écartée. Un encaissement concurrent se
  présentait alors à la PME comme un doublon de financement. Un `409` invite à
  réessayer, un `412` dit que rien ne rattrapera l'appel : la distinction est ce
  qu'un partenaire qui automatise ses reprises doit pouvoir brancher.
- **Corriger seulement l'écran** — écartée, c'est l'état d'avant. Un bouton
  masqué n'a jamais été un contrôle d'accès.

## Travail livré

### `apps/trust-api/src/financing/`

- `is-financeable.ts` — `STATUTS_FINANCABLES` (liste en positif),
  `motifCreanceNonCessible()` (`deja_encaissee` | `en_litige` | `null`),
  prédicat porté à 7 conditions, et `financeableInvoiceWhere()` aligné
  (`status: { in: [...] }`, `disputeStatus: { not: "disputed" }`).
- `financing.service.ts` — refus nommés en `412 PreconditionFailedException`
  avec les codes `FINANCING_INVOICE_ALREADY_SETTLED` /
  `FINANCING_INVOICE_DISPUTED`. Quand l'`updateMany` ne revendique aucune ligne,
  le motif est relu **dans la même transaction** avant de lever.
- `financing-eligibility.integration.spec.ts` — 6 tests contre un vrai Postgres.
- Specs unitaires enrichies (prédicat et service).

### `apps/web/src/lib/`

- `financing.ts` — `enLitigeActif()` posé sur `disputeStatus`, appliqué au
  masquage **et** à la décision d'interroger `GET /invoices/:id/financing/options`.
  Placé APRÈS l'exception de cession : une créance cédée puis contestée continue
  de nommer son cessionnaire (K5). Le commentaire qui documentait l'écart avec
  trust-api est réécrit — l'écart n'existe plus.
- `financing.spec.ts` — 5 cas ajoutés, dont la facture `issued` + `disputed` que
  le Set des statuts ne pouvait pas attraper, et la réouverture sur `resolved`.

### `docs/architecture/`

- `adr-121-financing-eligibility-barrier.md`.

## Vérification

| Passe | Résultat |
|---|---|
| `pnpm --filter trust-api typecheck` | 0 erreur |
| `pnpm --filter trust-api lint` | 0 erreur (3 warnings pré-existants) |
| `pnpm --filter trust-api test` | 161 fichiers / 1629 tests verts |
| `pnpm --filter web typecheck` | 0 erreur |
| `pnpm --filter web lint` | 0 erreur |
| `pnpm --filter web test` | 26 fichiers / 259 tests verts |

Le compte de tests web est celui de la branche, partie d'`app` : les 385 tests
cités ailleurs incluent la vitrine et les comptes de démo, qui vivent sur la
PR #13 et ne sont pas dans ce lot.

Le crash-test d'intégration vérifie le refus **et** l'absence d'écriture (la
ligne en base fait foi, pas l'exception), exerce la clause SQL directement, et
porte un témoin sur une créance légitime — sans lui, tous les autres passeraient
encore si le rail était fermé pour tout le monde. Lancé deux fois de suite pour
prouver l'idempotence du seed.

## Reste à faire

- Le seed d'intégration ne nettoie pas par `DELETE` : `invoice_event` est
  append-only (ADR-015, trigger Postgres, `code 23001`) et sa trace retient la
  facture. Le seed est donc idempotent sur des clés fixes et repose l'état par
  `UPDATE`. Toute future spec qui émet un événement doit suivre ce modèle.
- Rouvrir `partially_paid` demandera de financer `amountDue` — non traité.
