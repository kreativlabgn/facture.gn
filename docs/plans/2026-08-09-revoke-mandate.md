# Plan : Révoquer un mandat (F6, ADR-069)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — extension de `mandates/` existant (F5/F1, mergées), aucun nouveau modèle
- Persona affecté : practice_admin d'un cabinet/CGA qui met fin à une relation client (turnover, fin de mission)
- Données sensibles manipulées : aucune nouvelle
- Impact réglementaire : aucun direct

## Investigation préalable
Backlog (texte complet — la story la plus sparse de la série F) : "F6 — Révoquer un mandat `[MUST]` — Réf : ADR-069." Aucune phrase persona, aucun bullet, aucun endpoint spécifié — contrairement à F1/F5 qui en avaient.

ADR-069 (texte exact, seule source de scope disponible) : "Mandat (practice → organization) remplace membership individuelle. Accordé à l'entité cabinet, pas à un individu. **Révocation par cabinet** = tous les collaborateurs perdent l'accès. Turnover géré proprement. Acceptation explicite obligatoire (PWA ou *620# option 5.3 + PIN)."

**Décision de scope, motivée par le texte ADR lui-même** : ADR-069 ne nomme qu'UN SEUL acteur de la révocation — "Révocation **par cabinet**" — jamais l'organisation cliente. Une révocation bilatérale (l'organisation pourrait aussi vouloir couper l'accès) serait défendable en usage réel, mais inventerait une direction non référencée par le texte disponible ; cohérent avec la discipline déjà appliquée cette session (F1 n'a pas construit de rejet explicite faute de support ERD, F5 n'a pas construit le canal USSD PIN faute de scope détaillé). **F6 se limite donc à la révocation initiée par le cabinet** — un `practice_admin` révoque un mandat que sa `practice` détient. Une révocation initiée par l'organisation, si elle s'avère nécessaire, sera une story future distincte, non couverte par le texte ADR-069 actuel.

Ce choix a aussi l'avantage de garder F6 comme un mirroir quasi-exact de F5 (même acteur — `practice_admin`, même vérification en ligne déjà construite, même contrôleur `MandatesController`) plutôt que de dupliquer le pattern F1 (organisation) pour une direction non demandée.

## Problème (en 3 lignes max)
Une fois un mandat `active` (F1), rien ne permet à un cabinet de mettre fin à cet accès lorsqu'une mission se termine ou qu'un client change de comptable — `Mandate.status` ne peut aujourd'hui jamais atteindre `revoked`.

## Solution retenue (en 5 lignes max)
`POST /practices/:id/mandates/:mandateId/revoke` — ajoute une méthode `revoke()` à `MandatesController` existant (F5), même contrôleur, même acteur (`practice_admin`). Réutilise l'exacte même vérification d'autorisation en ligne que `create()` (F5) : `PracticeMember(practiceId, requesterUserId, role: practice_admin, leftAt: null)`. Le service charge le mandat (404 si absent OU si `mandate.practiceId !== practiceId` — jamais confirmer l'existence d'un mandat hors périmètre, même précédent que F1), vérifie `status === "active"` (409 sinon — seul un mandat actif peut être révoqué ; un `pending` non-accepté n'a rien à révoquer, un `revoked`/`expired` est déjà terminal), puis `update({status: "revoked", revokedAt: now()})`. `grantedBy`/`grantedAt` restent inchangés — trace historique de qui avait accepté, jamais effacée par la révocation.

## Alternatives écartées
Révocation initiée par l'organisation cliente — écartée : ADR-069 ne nomme que "révocation par cabinet", aucun texte disponible ne couvre la direction inverse ; story future distincte si le besoin est confirmé. Autoriser la révocation d'un mandat `pending` (annulation de demande plutôt que révocation d'accès) — écartée : le verbe "révoquer" suppose un accès effectivement accordé (ADR-069 : "tous les collaborateurs perdent l'accès"), un mandat jamais accepté n'a aucun accès à perdre ; laisser un `pending` sans action reste le mécanisme d'abandon déjà établi par F1.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/mandates/mandates.service.ts` — ajoute `revoke(practiceId, mandateId, requesterUserId)` : vérifie `practice_admin` (même check que `create()`), charge le mandat (404 si absent ou hors périmètre practice), vérifie `status === "active"` (409 sinon), `update({status: "revoked", revokedAt: now()})`
- [ ] Tâche 2 : `apps/trust-api/src/mandates/mandates.controller.ts` — ajoute `POST :mandateId/revoke` sur le contrôleur existant, aucun nouveau fichier de contrôleur ni de module

## Tests à écrire AVANT le code
- [ ] Test 1 (`mandates.service.spec.ts`) : révoque un mandat `active` détenu par la practice → `status: revoked`, `revokedAt` renseigné, `grantedBy`/`grantedAt` inchangés
- [ ] Test 2 : refuse si l'appelant n'est pas `practice_admin` de la practice ciblée (même garde que `create()`)
- [ ] Test 3 : refuse (404) si le mandat n'existe pas
- [ ] Test 4 : refuse (404) si le mandat existe mais est détenu par une AUTRE practice que `:id`
- [ ] Test 5 : refuse (409) si le mandat est `pending` (jamais accepté, rien à révoquer)
- [ ] Test 6 : refuse (409) si le mandat est déjà `revoked` ou `expired`

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune migration Prisma nécessaire (`Mandate` complet depuis F5)
- code-reviewer OK

## Risques identifiés & mitigations
- Risque 1 : révoquer deux fois le même mandat → mitigation : précondition `status === "active"`, la 2e tentative échoue proprement (409).
- Risque 2 : confondre practice appelante et practice détentrice du mandat ciblé → mitigation : vérification explicite `mandate.practiceId === practiceId` (test 4 dédié), même précédent que F1 (`organizationId`).
