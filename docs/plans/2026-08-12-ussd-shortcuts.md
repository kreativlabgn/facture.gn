# Plan : Raccourcis directs USSD (§5 Spec USSD)

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api/src/ussd/`) — dernière tâche de la feuille de route USSD.

## Investigation préalable

§5 : « Autorisés (émission anonyme et vérification uniquement) : `*620*1*250000#` (émission anonyme), `*620*2*A8K2P9Q1#` (vérification directe). Non autorisés : tout raccourci exposant un client identifié en clair ou des données sensibles. »

**Numérotation des raccourcis distincte du menu principal** — le "1" du raccourci (émission) ne correspond PAS à l'option 1 du menu (payer) ni à l'option 4 (émettre) : c'est un espace de numérotation séparé, propre aux raccourcis. Le "2" (vérification) coïncide avec l'option 2 du menu, mais par coïncidence seulement — traité indépendamment, jamais en réutilisant `input === "2"`.

ADR-054 (déjà lu, Registre-ADR) : « Facture anonyme plafonnée T0/acte — 500 000 GNF, indépendant du palier. » Interprétation littérale et minimale : le texte ne couvre QUE le plafond par acte (500 000 GNF), pas les fenêtres jour/semaine/mois — celles-ci restent gouvernées par le palier réel de l'organisation (`VelocityTierService`, déjà construit, D4). Rejet immédiat, avant toute authentification, si le montant du raccourci dépasse 500 000 GNF — pas un plafonnement silencieux à cette valeur.

## Décision d'architecture

Au niveau `handleRoot` (état `root`), AVANT le test `AUTHENTICATED_OPTIONS.has(input)` :
- `input` correspond à `/^1\*([1-9]\d*)$/` (émission anonyme) → montant capturé ; si > 500 000 GNF, réponse d'échec immédiate (`continue: false`), aucune authentification tentée (ADR-054, indépendant du palier — donc jamais une question de permission, un refus de format). Sinon, entre dans le MÊME sous-flux d'authentification que les options normales (`pendingOption: "anon_emit"`, montant déjà stocké dans le contexte — aucune collecte de montant ni de téléphone client, "anonyme" exclut tout client identifié).
- `input` correspond à `/^2\*(.+)$/` (vérification directe) → délègue directement à la même logique que `handleVerifyReceipt()` (§2.2, déjà construite), sans passer par l'état intermédiaire `verify_awaiting_code`.

`completeAuthentication` gagne une branche `pendingOption === "anon_emit"` → appelle `UssdInvoiceService.emitInvoice(organizationId, amountCentimes, undefined)` directement (jamais de `resolveOrCreateCustomer`, jamais un client attaché — "anonyme" au sens strict).

## Alternatives écartées

**Plafonner silencieusement à 500 000 GNF un montant supérieur** — écartée, un montant refusé doit être visible par l'utilisateur (cohérent avec la discipline générale de ce repo : jamais une correction silencieuse d'une intention utilisateur).

**Autoriser le chemin code compte (téléphone emprunté) pour les raccourcis** — non explicitement exclu par la spec, conservé : réutilisation intégrale du sous-flux d'authentification existant, aucune raison de le retirer pour ce cas précis.

## Découpage en tâches bite-sized
- [ ] Tâche 1 (RED) : `ussd-session.service.spec.ts` — raccourci émission valide → entre dans l'auth ; montant > 500 000 GNF → refus immédiat sans authentification ; raccourci vérification → même comportement que l'option 2 condensée en un seul échange ; émission anonyme aboutie → `emitInvoice` appelé avec `customerId: undefined`
- [ ] Tâche 2 (GREEN) : câblage dans `UssdSessionService`

## Critères de done
- Suite trust-api verte, typecheck/lint verts
- Aucune facture anonyme émise au-delà de 500 000 GNF, quel que soit le palier réel de l'organisation

## Risques identifiés & mitigations
- Aucun nouveau — réutilisation intégrale de sous-flux déjà testés (authentification, vérification, émission).
