# ADR-121 : Barrière d'éligibilité au refinancement du Capital Layer

> **Numérotation.** Ce texte a été approuvé sous l'intitulé « ADR-118 ». Ce numéro
> est déjà en service : il désigne la Vague 3 et sa série `e1`…`e5` (registre
> Merkle des factures, droits des personnes, rotation de clé de signature,
> rapprochement bancaire, PWA offline-first), référencé quinze fois dans le
> dépôt. ADR-119 (apurement automatique des Z de caisse) et ADR-120 (hébergement
> de la base) sont pris eux aussi. Renuméroté en **121**, premier libre — la
> décision, elle, est inchangée.
>
> Précise ADR-031, qui pose que `is_financeable()` est une règle composite unique
> et que toute modification en est un ADR. Voisine d'ADR-088/089 (rails de
> financement, anti-double-financement).

## Statut

Approuvé — 10 septembre 2026.

## Contexte

La fonction `is_financeable()` n'excluait à l'origine que le statut `VOIDED`
(annulé), permettant techniquement le rachat par des partenaires bancaires
(*Akiba Finance*) de créances déjà soldées ou en cours de contentieux, ouvrant un
risque lourd de fraude par double encaissement.

## Décision

1. Le prédicat d'éligibilité serveur exclut structurellement et de manière
   hermétique les documents aux statuts `PAID`, `PARTIALLY_PAID` et `DISPUTED`.
2. L'exclusion de `PARTIALLY_PAID` est requise pour interdire le rachat d'une
   valeur faciale globale (`totalTtc`) sur une créance déjà amortie par tranches.
3. Toute violation ou concurrence de transaction au moment de la mutation par une
   banque déclenche immédiatement une exception `PreconditionFailedException`
   (Code HTTP 412).

## Conséquences

### Le statut est une liste en positif, jamais une liste d'exclusions

`STATUTS_FINANCABLES = ["issued"]` (`apps/trust-api/src/financing/is-financeable.ts`).
Écrire la règle en exclusions aurait rendu finançable, par défaut, tout statut
ajouté plus tard à l'enum `InvoiceStatus` — c'est la faute d'origine que cet ADR
corrige, et la reproduire sous une autre forme n'aurait rien fermé. Sortent donc
du périmètre : `paid`, `partially_paid`, `voided`, `draft`, `converted`,
`expired`. Même discipline que `payment-eligibility.ts` côté money-api.

### « DISPUTED » n'est pas un statut, et c'est ce qui rend la règle nécessaire

Le litige vit dans un champ **séparé**, `Invoice.disputeStatus`
(`none | disputed | resolved`), orthogonal à `status`. Une facture peut être
`issued` **et** `disputed` en même temps : un prédicat qui n'aurait lu que
`status` aurait cédé une créance dont le montant est précisément en discussion.
`resolved` ne bloque pas — le litige est clos, la créance redevient cessible.

De même, il n'existe pas de statut « approuvé » : la validation par
l'ordonnateur est le booléen `validatedByAdministration`, posé par
`PublicBuyerPortalService.validateLiquidation()`, et il reste la première des
conditions du composite.

### La barrière vit en deux exemplaires, volontairement

`isFinanceable()` sert l'affichage ; `financeableInvoiceWhere()` sert le commit.
C'est la seconde — clause `where` d'un `updateMany` à l'intérieur de la
transaction — qui protège réellement de la concurrence : si un règlement tombe
entre la lecture et le commit, aucune ligne n'est revendiquée et la cession est
avortée. Les deux formes sont tenues par un test qui échoue dès qu'elles
divergent.

### Le refus est nommé

| Situation | HTTP | Code métier |
|---|---|---|
| Créance déjà encaissée | 412 | `FINANCING_INVOICE_ALREADY_SETTLED` |
| Litige actif | 412 | `FINANCING_INVOICE_DISPUTED` |
| Déjà financée, ou autre condition non remplie | 409 | — |

Quand la revendication transactionnelle échoue, le motif est relu **dans la même
transaction** avant de lever : sans cette relecture, un encaissement concurrent
se présentait à la PME comme un doublon de financement, et le partenaire n'avait
aucun moyen de savoir que la créance venait de s'éteindre. La distinction 412 /
409 porte cette différence — un 412 ne se réessaie pas, un 409 peut l'être.

### Ce que cette décision ferme, et ce qu'elle coûte

`PARTIALLY_PAID` est exclu tant que le décaissement est tracé à `totalTtc`. Si le
Trésor règle réellement par tranches et que le refinancement du solde doit être
rouvert, la condition à lever n'est pas celle-ci : il faut d'abord financer
`amountDue` et non `totalTtc`. Rouvrir le statut sans ce préalable rétablirait
exactement le double encaissement que cet ADR ferme.

## Vérification

`apps/trust-api/src/financing/financing-eligibility.integration.spec.ts` — six
tests contre un vrai Postgres. Ils vérifient le refus **et** l'absence
d'écriture (la ligne en base fait foi, pas l'exception levée), exercent la clause
SQL directement, et portent un témoin sur une créance légitime : sans lui, tous
les autres passeraient encore si le rail était fermé pour tout le monde.

Le seed est idempotent et repose l'état par `UPDATE`. `invoice_event` est
append-only (ADR-015, trigger Postgres qui refuse tout `DELETE`, `code 23001`) :
dès qu'une trace de décaissement s'attache à une facture, la facture devient
indestructible. Toute future spec d'intégration qui émet un événement doit suivre
ce modèle plutôt que nettoyer par suppression.

## Reste ouvert

`STATUTS_SANS_ARBITRAGE` (`apps/web/src/lib/financing.ts`) masque `paid` et
`voided`, mais pas `disputed` : l'écran de la PME propose encore l'arbitrage sur
une facture contestée, que le serveur refuse désormais en 412. À aligner côté
web — le masquage d'interface n'a jamais été la barrière, mais il ne doit pas
proposer une action que le serveur refuse.
