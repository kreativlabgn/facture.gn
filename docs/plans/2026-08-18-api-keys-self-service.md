# Plan : F15 — Gérer mes clés API en self-service

## Contexte projet
- Module : Trust Context — nouveau module `apps/trust-api/src/api-keys`
- Persona affecté : `developer_api` (nouveau rôle, ADR-097), aussi accessible à owner/admin (openapi : "developer_api/admin/owner")
- Données sensibles manipulées : secret de clé API — même niveau de rigueur qu'un mot de passe (jamais stocké en clair, jamais ré-affiché)
- Impact réglementaire : aucun

## Clarifications
- Q: F15 doit-elle inclure le mécanisme d'authentification par clé API + journalisation des appels (critère d'acceptation Backlog explicite), ou seulement la gestion self-service des clés ? → R: **Gestion des clés uniquement** (lister/générer/révoquer). L'openapi déjà existant (`openapi-facture-gn.yaml:1159-1219`, schémas `ApiKey`/`ApiKeyCreated`) ne spécifie NI authentification par clé, NI logs d'appels — seulement le CRUD. Construire l'authentification + logging serait une nouvelle brique d'architecture non spécifiée, un chantier de sécurité à part entière. Traité comme le gap webhook déjà accepté par ADR-097 lui-même ("gap distinct, non résolu ici").
- Q: Un endpoint de "rotation" dédié est-il nécessaire (le Backlog dit "faire tourner mes clés") ? → R: **Non** — l'openapi n'a que `GET`/`POST /api-keys` et `DELETE /api-keys/{id}`, aucune route de rotation. La rotation s'obtient en enchaînant révocation + génération côté client, sans nouvel endpoint.
- Q: Les routes de l'openapi sont plates (`/api-keys`, sans organisation dans l'URL) — reproduire tel quel ? → R: **Non, adapté** — aucun concept d'"organisation active" n'existe dans le JWT (`CurrentUserPayload` ne porte que `{ id }`, confirmé par lecture directe). Routes imbriquées sous `/organizations/:id/api-keys`, comme `/organizations/:id/fec` et `/organizations/:id/audit-log` déjà existants — réutilise directement `@OrganizationIdSource("organization")` déjà testé, aucune modification de `RolesGuard` requise.
- Q: `DELETE` (verbe openapi) ou `POST .../revoke` (convention 100% du repo) ? → R: **`POST :id/api-keys/:keyId/revoke`** — aucun `@Delete()` n'existe nulle part dans ce repo (vérifié par grep exhaustif) ; tous les "revoke"/résolutions existants (`resolveCreditLimitRequest`, `resolveRecovery`) utilisent déjà POST. Cohérence du repo retenue plutôt que fidélité littérale à l'openapi sur ce seul point.
- Q: Comment hacher le secret de clé API ? → R: Réutilise `PasswordService`/`Argon2PasswordService` déjà injectable (`PASSWORD_SERVICE` token, `auth.module.ts`) — même primitive que les mots de passe, pas de nouvelle dépendance crypto.
- Q: `lastUsedAt` (présent dans le schéma openapi `ApiKey`) — l'inclure dès maintenant ? → R: Oui, colonne nullable incluse pour la compatibilité du contrat public, mais **jamais renseignée par aucun code de cette story** (aucun mécanisme d'usage construit) — restera `null` jusqu'à une story future qui construit l'authentification par clé. Assumé explicitement, pas un oubli.

## Problème (en 3 lignes max)
`developer_api` (rôle V1 fantôme, ADR-097) n'a aujourd'hui aucun contenu fonctionnel : aucun moyen pour une organisation de générer, lister ou révoquer une clé API en self-service — toute intégration tierce dépend du support.

## Solution retenue (en 5 lignes max)
Nouveau modèle `ApiKey` (secret haché via `PasswordService`, jamais en clair au repos) et nouveau module `api-keys` avec 3 endpoints imbriqués sous `/organizations/:id/api-keys` : lister (masqué), générer (secret complet retourné une seule fois), révoquer (soft, `revokedAt`). Rôle `developer_api` ajouté à `OrganizationRole`. Vérification explicite que la clé révoquée appartient bien à l'organisation ciblée (IDOR), jamais une confiance aveugle en `:keyId`.

## Alternatives écartées
- **Authentification par clé API + logs d'appels dans cette story** — écartée (décision utilisateur) : nouvelle brique d'architecture non spécifiée, chantier de sécurité séparé.
- **Endpoint de rotation dédié** — écartée : couvert par révocation + génération, cohérent avec l'openapi existant.
- **Routes plates `/api-keys`** — écartée : aucune organisation active dans le JWT pour les résoudre sans paramètre explicite.
- **Vérifier `Organization.commercialTier` pour restreindre l'accès aux clés API à certains paliers** — écartée : Grille-Offres non consultée pour cette contrainte, hors scope du Backlog F15 tel qu'écrit ; à ajouter séparément si une story de tarification l'exige.

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] [P] Tâche 1 : `packages/db/prisma/schema.prisma` — ajouter `developer_api` à `enum OrganizationRole`
- [ ] [P] Tâche 2 : `packages/db/prisma/schema.prisma` — `enum ApiKeyEnvironment { production sandbox }` + modèle `ApiKey` (id, organizationId, environment, keyHash, keySuffix, createdAt, revokedAt, lastUsedAt) + relation `Organization.apiKeys`
- [ ] Tâche 3 : migration `packages/db/prisma/migrations/20260818XXXXXX_add_developer_api_role_and_api_keys/migration.sql`
- [ ] [P] Tâche 4 : `apps/trust-api/src/api-keys/dto/create-api-key.dto.ts` — `{ environment: z.enum(["production","sandbox"]) }`
- [ ] Tâche 5 : `apps/trust-api/src/api-keys/api-key-secret.ts` — génération (`crypto.randomBytes`, préfixe `fg_live_`/`fg_test_`) + calcul du `keySuffix` (4 derniers caractères)
- [ ] Tâche 6 : `apps/trust-api/src/api-keys/api-keys.service.ts` — `listApiKeys`, `createApiKey`, `revokeApiKey` (avec vérification d'appartenance à l'organisation)
- [ ] Tâche 7 : `apps/trust-api/src/api-keys/api-keys.controller.ts` — 3 routes, `@Roles("owner","admin","developer_api")`, `@OrganizationIdSource("organization")`
- [ ] Tâche 8 : `apps/trust-api/src/api-keys/api-keys.module.ts` — importe `AuthModule` pour `PASSWORD_SERVICE`

## Tests à écrire AVANT le code
- [ ] `api-keys.service.spec.ts` : `createApiKey` retourne le secret complet en clair, jamais stocké tel quel (vérifier que `prisma.apiKey.create` reçoit un `keyHash` différent du secret retourné)
- [ ] `api-keys.service.spec.ts` : `listApiKeys` ne retourne jamais `keyHash` ni le secret complet, seulement un label masqué
- [ ] `api-keys.service.spec.ts` : `listApiKeys` exclut les clés révoquées (`revokedAt` non null)
- [ ] `api-keys.service.spec.ts` : `revokeApiKey` pose `revokedAt`, idempotence — révoquer une clé déjà révoquée → `ConflictException`
- [ ] `api-keys.service.spec.ts` : `revokeApiKey` sur une clé appartenant à une AUTRE organisation → `NotFoundException` (IDOR), jamais un 200/204 silencieux
- [ ] `create-api-key.dto.spec.ts` : rejette un `environment` hors `["production","sandbox"]`
- [ ] `api-key-secret.spec.ts` : deux appels consécutifs génèrent des secrets différents (CSPRNG, pas de collision triviale) ; le préfixe reflète l'environnement (`fg_live_` vs `fg_test_`)

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant dans ce document
- Tous les tests verts
- Aucune donnée sensible loggée (secret jamais dans un log, jamais dans une erreur)
- Aucun hardcoded secret
- `dev-code-reviewer` OK
- `dev-security-reviewer` OK (secret de clé API — rigueur équivalente à un mot de passe)

## Risques identifiés & mitigations
- Risque 1 : `:keyId` d'une autre organisation utilisé pour révoquer via l'URL d'une organisation où l'appelant EST légitimement owner/admin (IDOR classique) → mitigation : vérification explicite `apiKey.organizationId === organizationId` dans le service, jamais une confiance aveugle en la ressource pointée par `:keyId`, `NotFoundException` générique (n'indique pas si la clé existe ailleurs).
- Risque 2 : secret loggé accidentellement (erreur non interceptée incluant le payload de la requête) → mitigation : le secret n'existe qu'en mémoire le temps de la requête, jamais renvoyé dans un message d'erreur, jamais stocké en clair.
