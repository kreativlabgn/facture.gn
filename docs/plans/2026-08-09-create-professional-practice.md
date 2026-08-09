# Plan : Créer un cabinet comptable ou un CGA (F4, ADR-068/078)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — nouveau périmètre `practices/`
- Persona affecté : comptable agréé (Mamadou) ou responsable CGA qui veut gérer plusieurs organisations clientes depuis un point d'entrée unique
- Données sensibles manipulées : aucune nouvelle (numéro d'agrément professionnel, pas une donnée personnelle sensible au sens PDP)
- Impact réglementaire : mécanisme CGA sous tutelle DGI (décret du 17 février 2017, abattement fiscal), pas d'impact direct de cette story qui ne fait que créer l'entité

## Problème (en 3 lignes max)
Aucun modèle `ProfessionalPractice`/`PracticeMember` n'existe — ADR-068 établit ce concept comme "entité de premier niveau parallèle à organization" mais rien n'a encore été construit, bloquant toute la série F (F1/F5/F6/F7/F9, mandats et dashboard cabinet).

## Solution retenue (en 5 lignes max)
Nouveau module `practices/`, `POST /practices` (aucun `@Roles()` — pas une action scopée à une organisation, n'importe quel utilisateur authentifié peut créer une practice, même principe que `POST /organizations`). Transaction Prisma créant `ProfessionalPractice` + `PracticeMember(role: practice_admin)` en une fois, mirroir direct de `organizations.service.ts:create()`. `ordreVerified` reste à son défaut `false` (même pattern que `dgiVerificationStatus`, B1/B4 → B2 : le champ est scaffoldé maintenant, sa vérification est une story future séparée). `tier` jamais accepté du client, défaut système `partner_free`.

## Alternatives écartées
Construire `MANDATE`/`REVENUE_SHARE` (autres tables de la même section ERD) dans la même story — écartée : F4 ne porte que sur la création de l'entité elle-même, F1/F5/F6 (backlog, stories séparées) couvrent le mécanisme de mandat. Étendre `OrganizationRole` pour y inclure `practice_admin` — écartée : ADR-068 est explicite, une practice est une entité parallèle, pas une extension d'`Organization` ; ses rôles (`practice_admin`/`accountant_external`/`business_manager`) sont structurellement distincts des 7 `OrganizationRole` existants.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — enums `ProfessionalPracticeType`, `ProfessionalPracticeTier`, `PracticeMemberRole` ; modèles `ProfessionalPractice`/`PracticeMember` (fidèles à l'ERD) ; relation `practiceMemberships PracticeMember[]` sur `User` ; migration manuelle
- [ ] Tâche 2 : `apps/trust-api/src/practices/dto/create-practice.dto.ts` (nouveau) — `name` (non-vide), `type` (enum à 4 valeurs), `registrationNumber` (optionnel), `phone` (`msisdnSchema` réutilisé), `email` (optionnel, `.email()`)
- [ ] Tâche 3 : `apps/trust-api/src/practices/practices.service.ts` (nouveau) — `create(dto, creatorUserId)` : transaction créant `ProfessionalPractice` (avec `ordreVerified: false`, `tier: "partner_free"` implicites via défauts DB) puis `PracticeMember(role: "practice_admin", userId: creatorUserId)`
- [ ] Tâche 4 : `apps/trust-api/src/practices/practices.controller.ts` + `practices.module.ts` (nouveaux) — `POST /practices`, aucun `@Roles()`, `@CurrentUser()` pour le créateur ; câblage dans `app.module.ts`

## Tests à écrire AVANT le code
- [ ] Test 1 (`practices.service.spec.ts`) : practice créée avec les champs fournis, type persisté tel quel
- [ ] Test 2 : le créateur devient automatiquement `PracticeMember` avec `role: "practice_admin"`
- [ ] Test 3 : `registrationNumber`/`email` absents → `null`, jamais un défaut serveur inventé
- [ ] Test 4 (`create-practice.dto.spec.ts`) : `type` hors des 4 valeurs autorisées → rejeté
- [ ] Test 5 (`create-practice.dto.spec.ts`) : `phone` mal formé (pas +224 E.164) → rejeté (même regex que `msisdnSchema`)

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Migration Prisma appliquée et vérifiée
- code-reviewer OK
- security-reviewer : non nécessaire (aucune donnée sensible, aucun secret)

## Risques identifiés & mitigations
- Risque 1 : confondre practice_admin avec un `OrganizationRole` existant dans un futur diff → mitigation : `PracticeMemberRole` est un enum Prisma entièrement distinct, jamais partagé avec `OrganizationRole`, documenté explicitement dans le commentaire du schema.
