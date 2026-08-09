# Plan : Accorder l'accès via un mandat (F1, ADR-068/069)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — extension de `mandates/` (F5, mergée), aucun nouveau modèle
- Persona affecté : propriétaire d'organisation (Aissatou, Ibrahima...) qui reçoit une demande de mandat d'un cabinet/CGA et doit l'accorder
- Données sensibles manipulées : aucune nouvelle
- Impact réglementaire : aucun direct (l'action elle-même n'active qu'une relation d'accès, déjà couverte par ADR-069)

## Investigation préalable
Backlog (texte complet) : "F1 — Inviter un comptable externe (via mandat cabinet) `[MUST]`. En tant que propriétaire d'organisation, je veux accorder l'accès via un mandat, afin de permettre à mon comptable d'exporter mon FEC. - Le mandat est accordé au cabinet, pas à un individu - Acceptation explicite (PWA ou *620# option 5.3 + PIN). Réf : ADR-068, ADR-069."

**Découverte cadrant le scope** : F1 et F5 partagent la même réf ADR-069 et le même modèle `Mandate` (F5, mergée) — ce ne sont pas deux mécanismes séparés mais les deux faces d'un seul cycle de vie. Preuve dans l'ERD lui-même : `Mandate.grantedBy` est documenté "→ USER (**owner/admin qui a accepté**)". F5 a déjà construit la création de la demande (initiée par le cabinet, `status: pending`) ; F1, littéralement "accorder l'accès" — le verbe "accorder" est l'action d'acceptation elle-même —, est la contrepartie manquante : le propriétaire de l'organisation ciblée accepte une demande `pending`, ce qui peuple `grantedBy`/`grantedAt` et fait transitionner `status: pending → active`. Sans cette story, F5 ne produit aucune valeur observable (un mandat `pending` qui ne peut jamais devenir `active`), et F6 (révoquer) ne peut être testée E2E faute d'un mandat `active` à révoquer — F1 est donc le prolongement naturel et nécessaire de F5, pas une story indépendante à scoper de zéro.

**Scope volontairement exclu — rejet explicite** : `MandateStatus` (ERD) n'a que 4 valeurs (`pending`/`active`/`revoked`/`expired`), aucune ne représente un "rejet". Construire un rejet explicite exigerait soit une 5e valeur d'enum non prévue par l'ERD, soit réutiliser `revoked` de façon sémantiquement trompeuse (un mandat jamais activé "révoqué" brouillerait l'audit trail). Cette story se limite donc strictement à l'acceptation (`pending → active`) — un propriétaire qui ne souhaite pas accorder l'accès laisse simplement la demande `pending` sans action (aucune régression, aucun risque : la garde anti-doublon de F5 empêche déjà toute confusion).

## Problème (en 3 lignes max)
`Mandate.status` ne peut aujourd'hui jamais devenir `active` — F5 crée des demandes `pending` mais rien ne permet à l'organisation ciblée de les accepter, rendant le mandat inutilisable en pratique.

## Solution retenue (en 5 lignes max)
`POST /organizations/:id/mandates/:mandateId/accept` — réutilise intégralement le guard existant `@Roles("owner","admin")` + `@OrganizationIdSource("organization")` (construit pour E8, zéro extension de `RolesGuard` nécessaire, zéro risque de régression sur les routes existantes). Le service charge le mandat, vérifie qu'il cible bien l'organisation `:id` (404 sinon — jamais confirmer l'existence d'un mandat appartenant à une autre organisation), vérifie `status === "pending"` (409 sinon — refuse d'accepter un mandat déjà `active`/`revoked`/`expired`), puis transitionne `status: active`, `grantedBy: actorId`, `grantedAt: now()`. Nouveau contrôleur `OrganizationMandatesController` (`organizations/:id/mandates`) dans le module `mandates/` existant — aucune migration Prisma requise, le modèle `Mandate` (F5) porte déjà tous les champs nécessaires.

## Alternatives écartées
Construire un rejet explicite (`status: revoked` avant toute activation) — écartée : aucune valeur ERD ne représente un rejet distinct d'une révocation post-activation ; laisser la demande `pending` sans action est un rejet de facto suffisant pour cette story MUST. Étendre `RolesGuard` avec un nouveau type d'`idSource` — écartée : `@OrganizationIdSource("organization")` (E8) couvre exactement ce besoin, `:id` de la route EST directement l'organisation ciblée. Fusionner ce contrôleur dans `OrganizationsController` existant — écartée : `organizations.controller.ts` n'a aucune route imbriquée `mandates/`, et le module `mandates/` (F5) est déjà le propriétaire naturel de tout ce qui touche `Mandate` (cohérence avec `MandatesService` déjà en place).

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/mandates/mandates.service.ts` — ajoute `accept(organizationId, mandateId, actorUserId)` : charge le mandat (404 si absent OU si `mandate.organizationId !== organizationId`), vérifie `status === "pending"` (409 sinon), `update({status: "active", grantedBy: actorUserId, grantedAt: now()})`
- [ ] Tâche 2 : `apps/trust-api/src/mandates/organization-mandates.controller.ts` (nouveau) — `POST organizations/:id/mandates/:mandateId/accept`, `@Roles("owner","admin")` + `@OrganizationIdSource("organization")`, câblage dans `mandates.module.ts` (aucun nouveau module, aucun changement `app.module.ts`)

## Tests à écrire AVANT le code
- [ ] Test 1 (`mandates.service.spec.ts`) : accepte un mandat `pending` ciblant l'organisation → `status: active`, `grantedBy`/`grantedAt` renseignés
- [ ] Test 2 : refuse (404) si le mandat n'existe pas
- [ ] Test 3 : refuse (404) si le mandat existe mais cible une AUTRE organisation que `:id` — jamais confirmer son existence
- [ ] Test 4 : refuse (409) si le mandat n'est pas `pending` (déjà `active`)
- [ ] Test 5 : refuse (409) si le mandat est `revoked` ou `expired`
- [ ] Aucun nouveau test `roles.guard.spec.ts` requis — réutilise `@OrganizationIdSource("organization")` déjà couvert par les tests E8, non-régression vérifiée en relançant la suite existante sans modification

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante, `roles.guard.spec.ts` non modifié)
- Aucune migration Prisma nécessaire (à confirmer : `Mandate` déjà complet depuis F5)
- code-reviewer OK

## Risques identifiés & mitigations
- Risque 1 : accepter deux fois le même mandat (double-clic, requêtes concurrentes) → mitigation : précondition `status === "pending"` avant l'`update`, la 2e requête trouve `status: active` et échoue proprement (409) plutôt que d'écraser `grantedAt`.
- Risque 2 : confondre organisation appelante et organisation ciblée par le mandat → mitigation : vérification explicite `mandate.organizationId === organizationId` (test 3 dédié), jamais une confiance implicite dans le guard seul (qui vérifie l'appartenance de l'appelant à l'organisation `:id`, pas la cohérence du mandat lui-même).
