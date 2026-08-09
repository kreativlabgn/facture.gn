# Plan : Assister une organisation sans accès permanent (F2, ADR-045)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — extension de `invoices/` existant, aucun nouveau modèle
- Persona affecté : agent terrain (Chemin B, ADR-045/046/047) qui aide un marchand déjà inscrit (via `createAssisted()`, B5) à émettre sa première facture, sans jamais devenir membre permanent de l'organisation
- Données sensibles manipulées : aucune nouvelle
- Impact réglementaire : aucun direct

## Investigation préalable
Backlog (texte, un seul bullet réf) : "F2 — Assister une organisation sans accès permanent `[MUST]` — Réf : ADR-045." DAT (ligne 85) donne le cadre structurel exact : *"Agent terrain : `assisted_session`, jamais de membership persistant."* — mis en parallèle explicite avec "Cabinet comptable ou CGA : mandat" (F1/F5/F6/F7/F9, mergées) et "Proche/assistant : viewer, invitable depuis *620#" (F3, hors scope USSD). Trois mécanismes de délégation d'accès distincts, un seul construit jusqu'ici pour son usage réel (mandat).

**Découverte confirmant le scope** : `AssistedSession` (`schema.prisma:277`) est créé par `OrganizationsService.createAssisted()` (B5) mais **jamais lu nulle part ailleurs** dans `apps/trust-api/src` (grep exhaustif) — exactement le pattern "scaffoldé mais jamais consommé" qui a motivé la sélection de cette story, symétrique à ce que F7/F9 ont fait pour `Mandate`. Aujourd'hui, un agent terrain qui vient d'inscrire un marchand (Chemin B) n'a **aucun moyen de revenir aider ce même marchand à émettre sa première facture** — `POST /invoices` exige un `OrganizationRole` via `RolesGuard`, et l'agent n'a délibérément aucun `OrganizationMember` (ADR-045/046/047 : jamais de membership pour l'agent).

**Confirmation croisée** : `POST /invoices` (`invoices.controller.ts:16-17`) autorise déjà `"field_agent"` — mais c'est l'`OrganizationRole` `field_agent` (memberhip permanente d'un rôle organisationnel), un concept **entièrement différent** de `User.isFieldAgent` (flag plateforme, ADR-045, vérifié en ligne par `createAssisted()`). Aucune confusion à faire entre les deux — ce diff ne touche jamais `OrganizationRole`.

## Problème (en 3 lignes max)
Un agent terrain qui a inscrit un marchand en Chemin B (B5) ne peut plus jamais l'aider ensuite — `AssistedSession` prouve le lien agent↔organisation mais n'autorise aucune action, contrairement au mandat cabinet qui, lui, donne un accès réel (F1/F5/F6/F7/F9).

## Solution retenue (en 5 lignes max)
`POST /invoices/assisted` — mirroir direct de `POST /organizations/assisted` (B5) : aucun `@Roles()`, vérification entièrement en ligne dans `InvoicesService.createAssisted(dto, fieldAgentUserId)` — (1) relit `user.isFieldAgent` depuis la DB (jamais fait confiance au JWT, même précédent que `OrganizationsService.createAssisted()`) ; (2) vérifie qu'un `AssistedSession(fieldAgentUserId, dto.organizationId)` existe (`ForbiddenException` sinon) ; (3) réutilise intégralement `createDraft(dto)` puis `issue(draft.id)` déjà testés — zéro duplication de logique métier, juste une nouvelle porte d'entrée. Portée volontairement réduite à "créer ET émettre" en une seule action atomique (pas de brouillon assisté qui traînerait) — cohérent avec le persona (agent aide à obtenir UNE vraie facture, pas un brouillon).

## Alternatives écartées
Étendre `RolesGuard` avec une 3e source d'autorisation (après `Mandate`) — écartée : `RolesGuard` vérifie une appartenance à un `OrganizationRole`, `isFieldAgent`/`AssistedSession` est un concept plateforme entièrement distinct (même raisonnement que F1/F5/F6/F7, jamais mélanger deux systèmes RBAC dans le guard partagé). Exposer `createAssisted()` en deux appels séparés (brouillon puis émission) — écartée : le persona n'a besoin que d'une vraie facture émise, une action atomique évite un brouillon assisté orphelin si l'agent ne revient jamais l'émettre. Ajouter une expiration à `AssistedSession` — écartée : aucun champ `expiresAt` dans le schema actuel, aucun mécanisme de révocation demandé par le backlog ; limitation documentée, cohérente avec le fait que `AssistedSession` est déjà perpétuelle depuis B5.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/invoices/invoices.service.ts` — ajoute `createAssisted(dto, fieldAgentUserId)` : relit `User.isFieldAgent`, vérifie `AssistedSession` existant, appelle `createDraft()` puis `issue()`
- [ ] Tâche 2 : `apps/trust-api/src/invoices/invoices.controller.ts` — ajoute `POST assisted`, aucun `@Roles()`, `@CurrentUser()` pour l'agent

## Tests à écrire AVANT le code
- [ ] Test 1 (`invoices.service.spec.ts`) : un agent terrain avec une `AssistedSession` pour l'organisation crée ET émet une facture en un seul appel (statut final `issued`, `number`/`certificationId` renseignés — réutilise `createDraft`+`issue` déjà testés)
- [ ] Test 2 : refuse si l'appelant n'a pas `isFieldAgent: true` (relu depuis la DB, jamais du JWT)
- [ ] Test 3 : refuse si aucune `AssistedSession` n'existe pour ce couple agent/organisation
- [ ] Test 4 : refuse si une `AssistedSession` existe mais pour une AUTRE organisation que `dto.organizationId`

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune migration Prisma nécessaire
- code-reviewer OK

## Risques identifiés & mitigations
- Risque 1 : un agent terrain assisterait une organisation qu'il n'a jamais inscrite → mitigation : vérification stricte `AssistedSession(fieldAgentUserId, organizationId)`, test 4 dédié.
- Risque 2 : `AssistedSession` perpétuelle (pas d'expiration) pourrait sembler un accès permanent déguisé → mitigation : documenté explicitement comme limitation acceptée, cohérente avec le scope déjà accepté pour B5 ; portée strictement à la création+émission de facture, jamais un accès équivalent à une vraie membership (pas de lecture, pas de paiement, pas d'autres actions).
