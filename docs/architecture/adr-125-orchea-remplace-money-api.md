# ADR-125 (provisoire) — ORCHEA remplace `money-api` : facture.gn ne gère plus le paiement en interne

> **Provisoire** : numéro et emplacement à confirmer dans `V/Registre-ADR-facture-gn.md`, même régime que
> l'ADR-120. 124 est le dernier numéro relevé dans ce dépôt (intégration du référentiel OHADA) ; un ADR
> écrit entre-temps dans un autre contexte peut l'avoir pris.
>
> **Décision du porteur du projet, 2026-10-02** : « money-api est ORCHEA mais externalisé. facture.gn ne
> gère plus le paiement en interne. » Puis : « Djomy et Moneroo sont hors contexte. On continue avec
> branchement direct sur les Mobile Money. Pour le reste, on s'aligne sur ce qu'a construit money-api
> nativement et on enrichit. »
>
> **Cet ADR ne change aucun code ni aucun schéma.** Il enregistre la décision, gèle `money-api` et
> ouvre le plan de retrait (`docs/plans/2026-10-03-orchea-remplace-money-api.md`).

## Contexte

ORCHEA est l'infrastructure d'orchestration de paiement du même porteur de projet. Elle vit dans un
**autre dépôt, avec un autre compte** (`orcheagn/-orchea-payment`), et facture.gn en est le premier
consommateur. Les deux projets n'ont aucun code commun ; leur seul point de convergence est
l'orchestration des paiements et des moyens de paiement.

`apps/money-api` porte déjà une orchestration complète : interface `PaymentProvider` unique (ADR-073),
registre avec bascule principal/repli et circuit breaker, liens de paiement, débit Mobile Money poussé,
webhooks `/webhooks/:provider` idempotents, réconciliation BullMQ, modèles `Payment`,
`PaymentProviderAttempt` et `PaymentWebhook`. **Seuls deux providers y existent, et ce sont des stubs**
(`djomy-stub`, `moneroo-stub`) : aucun paiement réel n'y passe. Le retirer ne défait donc aucun flux réel.

Garder les deux couches ferait porter à facture.gn deux orchestrations : une relance côté `money-api`
pendant qu'ORCHEA traite encore le paiement pourrait débiter le payeur deux fois.

## Décision

1. **ORCHEA est `money-api`, externalisé.** Le choix du rail, le risque, les tentatives, les relances, la
   réconciliation des tentatives incertaines et la notification du résultat appartiennent à ORCHEA.
2. **Ce qui reste à facture.gn** : le lien facture ↔ paiement, l'éligibilité d'une facture à être payée
   (annulée, soldée, en litige), la commission de plateforme (ADR-074), les états et écrans métier, les
   écritures comptables à réception du résultat, la réception des événements d'ORCHEA, la réconciliation
   bancaire (ADR-E4). **facture.gn ne parle jamais à un Provider.**
3. **Providers : connexion directe aux Mobile Money uniquement.** Orange Money et MTN MoMo ; Kulu est un
   rail prévu. **Djomy et Moneroo sont hors contexte** : aucun nouveau code ne s'y rapporte.
4. **Une seule couche d'orchestration.** Une fois un paiement créé chez ORCHEA, facture.gn ne bascule
   jamais vers un autre moyen de son côté. Un état incertain (`PENDING_RECONCILIATION` chez ORCHEA) n'est
   jamais traité comme un échec, et aucun second paiement n'est proposé tant qu'il n'est pas résolu.
5. **`money-api` est gelé, puis retiré par parité.** Il n'est plus étendu : ni nouveau provider, ni
   nouvelle bascule, ni nouvelle réconciliation. Il est retiré quand chaque ligne de la matrice de
   transfert d'ORCHEA est couverte et testée, qu'un encaissement par redirection et un par débit poussé
   passent de bout en bout sur le sandbox Orange et celui de MTN, que les webhooks d'ORCHEA sont reçus,
   vérifiés et dédupliqués ici, et que les tests de contrat passent dans les deux dépôts.
6. **Le contrat appartient à ORCHEA.** Il est versionné, en ajouts seulement. Le document de référence est
   unique et vit dans l'autre dépôt : `docs/integration/facture-gn.md` (contrat d'appel, correspondance des
   états, matrice de transfert, plan de transition). facture.gn le cite et ne le copie pas ; la version du
   SDK d'ORCHEA est épinglée ici.
7. **Le paiement est créé au clic du payeur, pas à l'émission de la facture.** `money-api` crée le lien à
   l'émission, avec 30 jours de validité ; une session de paiement d'un rail dure bien moins. Le lien
   porté par la facture ouvrira une page de facture.gn, et c'est elle qui crée le paiement chez ORCHEA.

## Alternatives écartées

- **Brancher ORCHEA comme un provider de plus dans le registre de `money-api`.** Deux orchestrations
  empilées, double relance, risque de double débit, et un contrat d'ORCHEA déformé pour entrer dans une
  interface pensée pour un seul provider.
- **Faire vivre les deux durablement** (ORCHEA pour certains rails, `money-api` pour d'autres). Deux
  sources de vérité sur l'état d'un paiement et deux réconciliations à tenir alignées.
- **Copier le code d'orchestration de `money-api` dans ORCHEA.** Les deux dépôts n'ont aucun code commun
  et doivent le rester.
- **Attendre qu'ORCHEA soit terminé avant de décider.** facture.gn continuerait de construire du paiement
  interne dans l'intervalle, et chaque brique serait à défaire.

## Conséquences

- **Le code existant ne change pas dans ce lot.** Recherche textuelle du 2026-10-03 : Djomy et Moneroo sont
  encore cités hors de `apps/money-api`, côté `trust-api` (`money-client/payment-link-client.ts`,
  `payments/dto/confirm-provider-payment.dto.ts`, `invoices`, `refunds`, `common/commission-grid.ts`,
  `financing` ; `revenue-share` et `ussd` dans leurs tests) et côté `web` (`app/pay/[invoiceId]`, `lib/checkout-fees.ts`,
  `lib/pay-session.ts`, `dashboard/invoices/[id]`). L'enum `PaymentProviderName` (`djomy`, `moneroo`,
  `orange_direct`, `mtn_direct`) est en base. Tout cela est du périmètre du plan, **avec des migrations
  additives seulement** jusqu'au retrait : jamais de renommage ni de suppression avant.
- **Les frais ne sont pas connus.** `money-api` calcule un taux plat de 1,4 % pour Djomy (stub). Les
  barèmes réels d'Orange et de MTN ne sont pas disponibles, et ORCHEA n'annoncera aucun frais tant qu'il
  n'en a pas : l'affichage des frais avant paiement (transparence tarifaire, ADR-106) dépend de ce point
  et ne pourra pas être réel avant.
- **Les états d'ORCHEA sont plus riches** (`REJECTED` distinct de `FAILED`, `PENDING_RECONCILIATION`
  incertain ou en attente du payeur) : la correspondance avec `pending / success / failed` est dans le
  document d'ORCHEA.
- **Un récepteur de webhooks d'ORCHEA est à construire ici** (signature sur le corps brut, dédoublonnage
  sur `eventId`, relecture par GET en cas de doute), à la place de `POST /webhooks/:provider`.
- **ADR touchés**, d'après les références relevées dans le code (à confirmer et annoter dans le
  Registre) : ADR-072 (Djomy principal, Moneroo repli), ADR-073 (orchestrateur interne), ADR-075 et
  ADR-076 (webhooks idempotents, confirmation), ADR-106 (transparence tarifaire).
- ORCHEA devient un composant dont dépend l'encaissement : sa disponibilité, ses alertes et son
  engagement de service sont des sujets partagés, à décider avant la mise en production.
- Les textes de ce dépôt qui présentent `money-api` comme l'orchestrateur Djomy → Moneroo (`CLAUDE.md`,
  `README.md`, `docs/architecture/README.md`) portent une note renvoyant à cet ADR ; ils décrivent le code
  actuel, qui reste ce qu'il est jusqu'au retrait.
