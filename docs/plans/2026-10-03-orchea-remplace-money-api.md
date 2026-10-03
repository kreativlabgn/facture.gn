# Plan : ORCHEA remplace `money-api` (retrait par parité, sans toucher au code avant le plan de chaque lot)

## Contexte facture.gn
- Bounded context : **Money Context** (`apps/money-api`), appelé par `trust-api` (`money-client`) et par `apps/web` (page de paiement publique, Server Action de débit poussé).
- Persona affecté : le payeur (lien, redirection ou débit poussé sur son téléphone) et l'organisation émettrice (états de paiement, écritures).
- Données sensibles : montants GNF, numéro de téléphone du payeur (il ne doit jamais être journalisé ; chez ORCHEA il est supprimé dès que le paiement est réglé).
- Décision : ADR-125 (provisoire) — ORCHEA remplace `money-api` ; Djomy et Moneroo hors contexte ; Mobile Money en direct (Orange, MTN ; Kulu prévu).
- Référence du contrat : dépôt ORCHEA (`orcheagn/-orchea-payment`), `docs/integration/facture-gn.md`. **Ce plan le cite, il ne le copie pas.** Version relue : commit `54d2794` d'ORCHEA, contrat d'API 0.2.0.

## Problème (en 3 lignes max)

`money-api` porte une orchestration de paiement dont les deux seuls providers sont des stubs. ORCHEA est la même orchestration, construite à part, qui sera branchée sur Orange et MTN. Tant que les deux coexistent sans plan, facture.gn risque d'étendre l'une, de câbler l'autre, et d'avoir deux couches pour un même paiement.

## Solution retenue (en 5 lignes max)

Un **port au niveau orchestration** (« démarrer un encaissement », « lire l'issue », « recevoir l'issue »), pas au niveau provider, avec un **adaptateur ORCHEA** écrit contre le simulateur d'ORCHEA (`ORCHEA_SIMULATOR_MODE=mobile-money`). `money-api` est gelé tout de suite et retiré quand la matrice de parité d'ORCHEA est couverte. Les données ne reçoivent que des ajouts (valeur d'énumération, colonnes nullables pour l'identifiant ORCHEA). Le paiement est créé au clic du payeur.

## Alternatives écartées

- **ORCHEA comme provider de plus dans le registre de `money-api`** : double orchestration, risque de double débit.
- **Coexistence durable par rail** : deux sources de vérité sur l'état d'un paiement.
- **Copier l'orchestration de `money-api` dans ORCHEA** : les deux dépôts n'ont aucun code commun.
- **Attendre qu'ORCHEA soit terminé** : facture.gn continuerait de construire du paiement interne.

## Découpage en tâches

Aucune de ces tâches n'est commencée. **Chacune demande son propre plan avant son code** (CONTRIBUTING §1).

- [ ] Tâche 0 : geler `money-api` — aucune extension, aucun provider ni nouvelle bascule ; poser la règle dans `CLAUDE.md` (fait par l'ADR-125).
- [ ] Tâche 1 : inventaire des appels à `money-api` (liens, débit poussé, checkout, webhooks, réconciliation) et des références à Djomy et Moneroo hors de `apps/money-api` (liste dans l'ADR-125).
- [ ] Tâche 2 : le port d'orchestration et l'adaptateur ORCHEA contre le simulateur d'ORCHEA (redirection et débit poussé, `externalReference` = identifiant de facture, une `Idempotency-Key` par tentative de paiement de facture.gn).
- [ ] Tâche 3 : le récepteur de webhooks d'ORCHEA dans `trust-api` — signature sur le corps brut, dédoublonnage sur `eventId`, ordre inversé et doublons acceptés, relecture par GET en cas de doute ; événements `TransactionConfirmed`, `TransactionRejected`, `TransactionFailed`, `PaymentAttemptUnknown`, `PaymentAttemptActionRequired`.
- [ ] Tâche 4 : la correspondance des états côté écrans et écritures — `REJECTED` distinct de `failed` ; `PENDING_RECONCILIATION` jamais traité comme un échec ni occasion d'un second paiement ; une attente du payeur n'est pas une anomalie.
- [ ] Tâche 5 : la page de paiement crée le paiement au clic (le lien de la facture ouvre une page, il ne porte plus une session de rail) ; écran d'attente avec la redirection ou l'instruction.
- [ ] Tâche 6 : migrations **additives** (identifiant ORCHEA nullable, valeur d'énumération), jamais de renommage ni de suppression avant le retrait.
- [ ] Tâche 7 : les frais — décision à prendre quand des barèmes d'Orange et de MTN existeront ; d'ici là, aucun frais réel à afficher avant paiement.
- [ ] Tâche 8 : retrait de `money-api` (service, modèles, enum, stubs, variables d'environnement, CI) quand les critères de l'ADR-125 §5 sont remplis.

## Tests à écrire AVANT le code (par lot, au moment de son plan)

- [ ] Des tests de contrat de l'adaptateur contre le simulateur d'ORCHEA, dans les deux modes (redirection, débit poussé).
- [ ] Des tests du récepteur : signature invalide, signature valide sur corps altéré, doublon, ordre inversé.
- [ ] Un test qui interdit qu'un état incertain ou en attente du payeur soit traité comme un échec.
- [ ] Un test qui interdit toute écriture du numéro du payeur dans un journal.

## Critères de done

- [ ] Ceux de l'ADR-125 §5 pour le retrait ; pour ce lot-ci (documentaire) : l'ADR et ce plan sont relus.

## Risques identifiés & mitigations

- Risque 1 : étendre `money-api` « pour aller vite » → mitigation : la règle de gel est dans `CLAUDE.md`.
- Risque 2 : ORCHEA n'est pas connecté à un rail réel (accès sandbox Orange demandé le 26/09/2026, pas encore reçu) → mitigation : tout est écrit contre le simulateur ; le retrait attend le sandbox.
- Risque 3 : les frais réels sont inconnus → mitigation : aucune valeur supposée ; la tâche 7 attend les barèmes.
- Risque 4 : la disponibilité d'ORCHEA devient celle de l'encaissement → mitigation : à décider avec ORCHEA avant la mise en production (alertes, engagement de service).
