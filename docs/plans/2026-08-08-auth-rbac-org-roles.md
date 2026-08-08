# Plan : Authentification (JWT RS256) + RBAC organisationnel (7 rôles MVP)

## Contexte facture.gn
- Bounded context : Trust Context (Squad Trust) — IAM, organisations multi-tenant
- Persona affecté : équipe de développement (pas encore d'UI exposée) ; prépare l'accès pour les 10 personas PME (Aissatou/owner, Mariama/cashier via USSD plus tard, etc.)
- Données sensibles manipulées : `password_hash` (déjà en base, jamais loggé), clé privée RS256 (JWT), appartenance utilisateur↔organisation
- Impact réglementaire : aucun accès aux données de facturation ne doit être possible sans authentification + vérification de rôle — prérequis de toute conformité (Loi L/2016/037/AN protection des données)

## Problème (en 3 lignes max)

`trust-api` est aujourd'hui entièrement ouvert : n'importe qui peut créer une organisation ou émettre/annuler une facture sans authentification ni notion de rôle. Aucun modèle ne relie un `User` à une `Organization` avec un rôle — condition préalable à tout accès multi-tenant sécurisé.

## Solution retenue (en 5 lignes max)

Nouveau modèle `OrganizationMember` (userId, organizationId, role parmi les 7 rôles MVP de base) relie `User` à `Organization`. Module `auth` NestJS : `POST /auth/register` (nom, msisdn, mot de passe → hash Argon2id) et `POST /auth/login` (→ JWT RS256, `ADR-011`, payload minimal `{ sub: userId }`, jamais de rôle mis en cache dans le token). `JwtAuthGuard` global (allowlist explicite `@Public()` pour `/auth/*` et `/docs`) + `RolesGuard` avec décorateur `@Roles(...)` qui résout le rôle **à chaque requête** depuis `OrganizationMember` (jamais depuis le token, pour éviter un rôle périmé après changement). `organizations.create` crée automatiquement le créateur comme `owner`.

## Alternatives écartées

- **9 rôles MVP en une fois (incl. `accountant_external`/`practice_admin`)** : écarté pour ce sprint — ces deux rôles dépendent du mécanisme de mandat cabinet/CGA (`PROFESSIONAL_PRACTICE`/`PRACTICE_MEMBER`/`MANDATE`, ADR-069) qui n'est pas scaffoldé ; cohérent avec le phasage historique déjà acté (ADR-027 : MVP=7 → ADR-070 : +2). Sprint suivant dédié.
- **Signature Ed25519 par requête (`X-Facture-Signature`, ADR-011)** : écarté — mécanisme distinct et non-bloquant pour livrer login + RBAC ; sprint séparé une fois le login en place.
- **Rôle embarqué dans le JWT** : écarté — un rôle mis en cache dans le token resterait valide jusqu'à expiration même après révocation/changement de rôle ; le coût d'une requête DB supplémentaire par appel est acceptable au regard du risque de privilège périmé.
- **bcrypt plutôt qu'Argon2id** : écarté — Argon2id est le standard actuel recommandé (OWASP), coût de migration nul à ce stade (aucun hash existant en base).

## Découpage en tâches bite-sized (2–5 min chacune)

- [x] Tâche 1 : Prisma — enum `OrganizationRole` (owner/admin/accountant_internal/cashier/field_agent/delivery_driver/client_portal) + modèle `OrganizationMember` (userId, organizationId, role, revokedAt nullable, `@@unique([organizationId, userId])`) + relations sur `User`/`Organization`
- [x] Tâche 2 : Migration Prisma appliquée (`db:migrate`) contre l'instance Postgres locale
- [x] Tâche 3 : `PasswordService` (interface) + implémentation Argon2id (`argon2` package) — `hash()`/`verify()`
- [x] Tâche 4 : `AuthTokenService` (interface) + implémentation JWT RS256 (`@nestjs/jwt`) — clé privée/publique via `.env` (dev), TODO explicite référençant Vault (ADR-008) pour la prod
- [x] Tâche 5 : `POST /auth/register` (dto Zod : name, msisdn, password) — crée `User` + `UserPhone` primaire, rejette msisdn dupliqué
- [x] Tâche 6 : `POST /auth/login` (dto Zod : msisdn, password) — vérifie le hash, émet le JWT, message générique si échec (jamais "user inconnu" vs "mauvais mot de passe" séparément — anti énumération)
- [x] Tâche 7 : `JwtAuthGuard` global (`APP_GUARD`) + décorateur `@Public()` pour `/auth/register`, `/auth/login`, `/docs` + décorateur `@CurrentUser()`
- [x] Tâche 8 : `RolesGuard` + décorateur `@Roles(...)` — résout la cible organisation (param direct, ou lookup `invoice.organizationId` pour les routes `:id`) et vérifie `OrganizationMember` actif avec le bon rôle ; 403 explicite si absent/mauvais rôle, jamais 500
- [x] Tâche 9 : `organizations.service.create()` prend `creatorUserId`, crée `OrganizationMember(role: owner)` dans la même transaction Prisma
- [x] Tâche 10 : `invoices.controller` — `@Roles(owner, admin, accountant_internal, cashier, field_agent)` sur `create`, `@Roles(owner, admin, cashier)` sur `issue`, `@Roles(owner, admin)` sur `void`
- [x] Tâche 11 : OpenAPI — schéma bearer JWT enregistré dans `main.ts` (`addBearerAuth`)
- [x] Tâche 12 : `.env.example` mis à jour (clés JWT placeholders) + doc génération clé RS256 dans README

## Tests à écrire AVANT le code

- [x] Test 1 : `password.service.spec.ts` — hash ≠ mot de passe en clair, `verify()` vrai pour le bon mot de passe, faux sinon
- [x] Test 2 : `auth.service.spec.ts` — `register()` rejette un msisdn dupliqué ; `login()` échoue avec message générique identique pour "utilisateur inconnu" et "mauvais mot de passe" (anti énumération) ; `login()` réussi renvoie un JWT dont le payload décodé contient `sub` et rien d'autre de sensible
- [x] Test 3 : `roles.guard.spec.ts` — autorise quand `OrganizationMember` actif a un rôle inclus dans `@Roles(...)` ; refuse (403) quand le rôle ne correspond pas ; refuse (403) quand aucun membership n'existe pour cette organisation ; refuse quand le membership est `revoked`
- [x] Test 4 : `jwt-auth.guard.spec.ts` — refuse (401) sans header `Authorization`, refuse un JWT invalide/expiré, laisse passer une route `@Public()` sans token
- [x] Test 5 : `organizations.service.spec.ts` (étendu) — `create()` crée bien un `OrganizationMember(role: owner)` pour le créateur, dans la même transaction (rollback si l'un des deux échoue)
- [x] Test 6 : `invoices.service.spec.ts` / test d'intégration guard — un membre `client_portal` ne peut pas appeler `issue()`/`void()` ; un membre `field_agent` ne peut pas appeler `void()`

## Critères de done

- [x] Tous les tests verts (unitaires + intégration Postgres existante non cassée)
- [x] Aucune donnée sensible loggée (password en clair, JWT complet, clé privée)
- [x] Aucun hardcoded secret (clés JWT via `.env`, jamais committées — `.env.example` en placeholders uniquement)
- [x] `pnpm turbo lint typecheck test` passe en local et en CI (service Postgres déjà configuré)
- [x] `dev-security-reviewer` passé sur le module `auth` (données sensibles : password_hash, clé privée JWT, tokens)
- [x] Aucune régression sur les endpoints `organizations`/`invoices` existants (tests déjà verts adaptés, pas supprimés)

## Risques identifiés & mitigations

- Risque 1 : casser les tests service existants (`organizations.service.spec.ts`, `invoices.service.spec.ts`) qui ne connaissent pas encore de contexte utilisateur → mitigation : les guards vivent au niveau HTTP (controller), testés séparément ; les tests de service existants sont étendus, pas réécrits from scratch
- Risque 2 : clé privée RS256 committée par erreur → mitigation : suit le même pattern que `.env`/`.env.example` déjà en place et gitignoré ; script de génération documenté dans le README, jamais de clé réelle dans le dépôt
- Risque 3 : confusion rôle global vs rôle par organisation (un même `User` peut avoir des rôles différents selon l'organisation, ex. `owner` chez lui, `client_portal` chez un client) → mitigation : rôle jamais mis en cache dans le JWT, toujours résolu depuis `OrganizationMember` à la requête
- Risque 4 : énumération d'utilisateurs via des messages d'erreur différenciés au login → mitigation : message générique unique ("identifiants invalides") que ce soit msisdn inconnu ou mot de passe erroné (Test 2)

## Vérification bout-en-bout (au-delà des tests unitaires)

Les 48 tests unitaires passaient tous, mais `trust-api` n'avait **jamais réellement démarré en HTTP** avant ce sprint (seuls `vitest` et `prisma generate` avaient été exécutés — voir plan bootstrap). Faire tourner le serveur réel (register → login → création d'org → cycle de vie facture → 403/404) a révélé 4 bugs invisibles aux tests unitaires, tous corrigés et couverts :

- **Packaging monorepo (pré-existant, indépendant de l'auth)** : `packages/db` exposait `main`/`types` vers `src/index.ts` (source TS) au lieu de `dist/`. Node ne transpile pas correctement ce fichier au runtime (`getPrismaClient is not a function`) — aucun serveur trust-api n'avait donc jamais pu démarrer, avec ou sans mes changements. Corrigé : `main`/`types` pointent vers `dist/`, et `turbo.json` déclare `dev: { dependsOn: ["^build"] }` pour que `pnpm turbo dev` reste utilisable sur un clone frais sans étape de build manuelle.
- **`@UsePipes()` scope niveau méthode (introduit par ce sprint)** : appliqué sur `create()` d'`OrganizationsController`, il validait aussi `@CurrentUser()` contre le schéma Zod de l'organisation (échec silencieux en "Required" sur tous les champs). Corrigé : pipe scopé au seul paramètre `@Body()`.
- **Sérialisation BigInt (pré-existant, indépendant de l'auth)** : `JSON.stringify` ne sait pas sérialiser un `BigInt` — toute réponse contenant un montant (`Invoice.totalTtc`, etc.) plantait en 500. Jamais exercé avant faute de test HTTP réel. Corrigé : `BigInt.prototype.toJSON` global dans `main.ts`, sérialisé en string (jamais en `number`, pour ne pas perdre de précision au-delà de `Number.MAX_SAFE_INTEGER` — cohérent avec ADR-014).
- **`RolesGuard` 500 brut sur facture inexistante (introduit par ce sprint)** : `findUniqueOrThrow` laissait fuiter une `NotFoundError` Prisma non interceptée. Corrigé : `findUnique` + `NotFoundException` explicite (404 propre), test dédié ajouté.

Parcours vérifié manuellement en HTTP réel : register, login (bon + mauvais mot de passe → 401 générique), création d'org sans token (401), création d'org avec token (owner auto), création/émission/annulation de facture par l'owner, tentative d'un utilisateur sans membership (403), facture inexistante (404 propre).
