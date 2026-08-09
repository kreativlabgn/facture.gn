# Plan : B5 — Onboarding assisté avec session traçable

## Contexte facture.gn
- Module : Trust Context — `apps/trust-api/src/organizations/`, `apps/trust-api/src/auth/`
- Persona affecté : agent terrain (Fanta, Mariama — non, Fanta/Mariama sont les marchandes assistées ; l'agent est un acteur distinct, non-persona documenté nommément)
- Données sensibles manipulées : NIF (optionnel), code-compte (identifiant d'accès alternatif)
- Impact réglementaire : ADR-045 (inscription toujours assistée ou PWA, jamais USSD pur), ADR-046/047

## Problème (en 3 lignes max)
Mariama et Fanta ne peuvent pas s'inscrire seules (pas de smartphone, pas toujours de numéro exploitable) — il faut qu'un agent terrain les inscrive pour elles, sans jamais devenir membre de leur organisation, et sans qu'elles aient besoin d'un mot de passe pour être immédiatement opérationnelles.

## Solution retenue (en 5 lignes max)
`POST /organizations/assisted` (JWT + `isFieldAgent=true`, nouveau flag plateforme sur `User`) crée en une transaction : un `User` marchand sans mot de passe (`passwordHash: null`, déjà correctement rejeté par `login()` existant), une `Organization` avec un `accountCode` (8 caractères Base32, vérification de collision à la génération — ADR-047), une `OrganizationMember(role: owner)` pour ce marchand, et une `AssistedSession` traçant l'agent, l'organisation, et le consentement explicitement enregistré. Le statut `isFieldAgent` est accordé via un endpoint interne dédié (nouveau secret, jamais réutilisé — 3ᵉ occurrence du même pattern que B2/DGI).

## Alternatives écartées
- **Créer une membership pour l'agent terrain** — écarté : le backlog est explicite ("jamais de membership persistante créée pour l'agent"), confirmé par le DAT §Sécurité.
- **Construire l'authentification par code-compte+PIN dans ce même plan** — écarté : c'est D2 (ADR-046), une story séparée. Aucun concept de PIN n'existe dans ce schéma aujourd'hui — l'introduire ici mélangerait deux responsabilités distinctes (produire le code vs. l'utiliser pour se connecter).
- **Réutiliser `OrganizationRole.field_agent` existant** — écarté : ce rôle est scopé à une organisation (ex. livreur d'un marchand), un tout autre concept que l'agent terrain plateforme qui inscrit de nouveaux marchands sans jamais appartenir à leur organisation.
- **Réutiliser `MONEY_API_INTERNAL_KEY` ou `DGI_VERIFICATION_INTERNAL_KEY`** — écarté : périmètres de confiance différents, jamais confondus (principe déjà établi et déjà appliqué deux fois cette session).

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — `User.isFieldAgent Boolean @default(false)`, `Organization.accountCode String? @unique`, nouveau modèle `AssistedSession` (id, fieldAgentUserId, organizationId, consentRecordedAt, createdAt) + migration
- [ ] Tâche 2 : `apps/trust-api/src/common/field-agent-auth.guard.ts` (nouveau) — mirroir exact de `dgi-verification-auth.guard.ts`, secret dédié `FIELD_AGENT_GRANT_INTERNAL_KEY`
- [ ] Tâche 3 : `apps/trust-api/src/auth/auth.service.ts` — `grantFieldAgentStatus(userId)` : `user.update({isFieldAgent: true})`, `NotFoundException` propre si l'utilisateur n'existe pas
- [ ] Tâche 4 : `apps/trust-api/src/auth/auth.controller.ts` — route `POST /auth/field-agents/:userId/grant`, `@Public()`+`@UseGuards(FieldAgentAuthGuard)`, même pattern que `verify-dgi`
- [ ] Tâche 5 : `apps/trust-api/src/organizations/account-code.ts` (nouveau) — `generateAccountCode()` (8 caractères Base32, alphabet standard RFC4648 sans padding)
- [ ] Tâche 6 : `apps/trust-api/src/organizations/dto/create-assisted-organization.dto.ts` (nouveau) — nom de l'organisation + régime fiscal + forme juridique (mêmes règles que B1/B4, NIF/eTax conjoints optionnels), nom du marchand, msisdn optionnel, `consentRecorded` obligatoirement `true` (littéral, jamais un défaut silencieux)
- [ ] Tâche 7 : `apps/trust-api/src/organizations/organizations.service.ts` — `createAssisted(fieldAgentUserId, dto)` : transaction (créer `User` sans mot de passe, `UserPhone` si msisdn fourni, `Organization` avec `accountCode` généré + retry sur collision, `OrganizationMember(role: owner)`, `AssistedSession`)
- [ ] Tâche 8 : `apps/trust-api/src/organizations/organizations.controller.ts` — route `POST /organizations/assisted`, JWT requis, vérification manuelle `user.isFieldAgent` dans le service (pas `@Roles()`, pas un `OrganizationRole`)

## Tests à écrire AVANT le code
- [ ] Test 1 : `field-agent-auth.guard.spec.ts` — mirroir exact des tests `dgi-verification-auth.guard.spec.ts`
- [ ] Test 2 : `auth.service.spec.ts` — `grantFieldAgentStatus()` met à jour `isFieldAgent`
- [ ] Test 3 : `account-code.spec.ts` — `generateAccountCode()` retourne 8 caractères, alphabet Base32 valide, jamais deux appels identiques (probabiliste sur un grand nombre d'appels)
- [ ] Test 4 : `organizations.service.spec.ts` — `createAssisted()` refuse un appelant sans `isFieldAgent=true`
- [ ] Test 5 : `organizations.service.spec.ts` — `createAssisted()` crée un `User` avec `passwordHash: null`
- [ ] Test 6 : `organizations.service.spec.ts` — `createAssisted()` ne crée AUCUNE `OrganizationMember` pour l'agent terrain, uniquement pour le marchand (`role: owner`)
- [ ] Test 7 : `organizations.service.spec.ts` — `createAssisted()` refuse une requête sans `consentRecorded: true`
- [ ] Test 8 : `organizations.service.spec.ts` — `createAssisted()` crée l'`AssistedSession` avec le bon `fieldAgentUserId`/`organizationId`

## Critères de done
- Tous les tests verts (suite complète)
- Build/lint/typecheck verts
- Vérification E2E réelle : élévation d'un utilisateur en field agent → inscription assistée d'un marchand → organisation créée avec `accountCode` → aucune `OrganizationMember` pour l'agent (vérifié en base) → tentative d'inscription assistée par un non-field-agent refusée → tentative sans `consentRecorded` refusée
- `dev-code-reviewer` OK
- `dev-security-reviewer` obligatoire (nouveau secret plateforme, code-compte, NIF)

## Risques identifiés & mitigations
- **Risque** : collision du code-compte à l'échelle (8 caractères Base32 = 40 bits, réel à grande échelle). **Mitigation** : vérification d'unicité + retry à la génération (ADR-047), contrainte `@unique` en base comme filet ultime.
- **Risque** : un utilisateur normal usurpe le statut d'agent terrain. **Mitigation** : secret dédié, jamais réutilisé, même rigueur que B2.
- **Risque** : consentement non réellement recueilli, juste coché par défaut. **Mitigation** : `consentRecorded` doit être explicitement `true` (littéral Zod), aucune valeur par défaut, testé explicitement (Test 7).
