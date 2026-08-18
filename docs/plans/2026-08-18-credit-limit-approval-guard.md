# Plan : E5 — Garde d'approbation de limite de crédit

## Contexte projet
- Module : Trust Context — `apps/trust-api/src/customers`
- Persona affecté : admin/owner (proposent une hausse), rôle `approver` (valide au-delà du seuil)
- Données sensibles manipulées : exposition financière du marchand (limite de crédit client, GNF) — pas de PII/secret de paiement direct
- Impact réglementaire : aucun cadre légal spécifique ; contrôle interne de gouvernance (séparation des pouvoirs, ADR-083 "jamais une décision unilatérale")

## Clarifications
- Q: Où stocker le seuil configuré (ADR-058) ? → R: Champ minimal `Organization.creditLimitApprovalThreshold` (BigInt nullable) + constante de fallback si non défini. Convention déjà établie deux fois dans ce repo (`commission-grid.ts` ADR-074, `tax-regime.ts` C4) : CONFIG_PARAMETER n'a jamais été scaffoldée, refusée à chaque fois pour ce même type de besoin. E5 suit cette convention plutôt que de la rompre.
- Q: Qui peut approuver une demande au-delà du seuil ? → R: Rôle `approver` uniquement (fidèle au texte ADR-083), jamais owner/admin en substitut.
- Q: Le demandeur peut-il approuver sa propre demande s'il cumule aussi le rôle `approver` ? → R: Bloqué, même règle que `AuthService.resolveRecovery()` (`auth.service.ts:110`).
- Q: Valeur du seuil de fallback par défaut ? → Aucune valeur n'est spécifiée dans le Backlog/ADR-083/ADR-058. Défaut retenu : **10 000 000 GNF**, en constante `DEFAULT_CREDIT_LIMIT_APPROVAL_THRESHOLD`, override possible par organisation via le nouveau champ. Valeur arbitraire mais sans risque : ajustable en un point unique, jamais gravée dans une migration de données.
- Q: La création d'un client avec un `creditLimit` initial est-elle concernée ? → R: Non — ADR-083 ne vise que les **augmentations post-création** ("Rien ne change au MVP : création/modification de client reste ouverte à cashier/field_agent/admin/owner sans restriction nouvelle"). `POST /customers` (création) reste inchangé.
- Q: Une baisse de limite est-elle soumise à approbation ? → R: Non, seule une **hausse** au-delà du seuil déclenche l'approbation (texte ADR-083 : "Toute augmentation... au-delà d'un seuil"). Une baisse s'applique toujours immédiatement (admin/owner).

## Problème (en 3 lignes max)
`customer.creditLimit` existe déjà mais n'importe quel admin/owner peut l'augmenter unilatéralement, sans limite. ADR-083 exige qu'au-delà d'un seuil configuré, la hausse passe par une validation du rôle `approver` — cette garde n'existe pas encore, ni même le rôle `approver` dans l'enum RBAC.

## Solution retenue (en 5 lignes max)
Ajouter le rôle `approver` à `OrganizationRole` et un champ de seuil sur `Organization`. Un nouvel endpoint `POST /customers/:id/credit-limit` (owner/admin) applique la hausse immédiatement si elle reste sous le seuil, sinon crée une `CreditLimitChangeRequest` en attente. Un second endpoint `POST /customers/credit-limit-requests/:requestId/resolve` (rôle `approver` uniquement, jamais le demandeur) approuve ou rejette — pattern calqué sur `AuthService.resolveRecovery()` (transaction `updateMany` sur statut `pending` pour la sécurité de concurrence).

## Alternatives écartées
- **CONFIG_PARAMETER générique (ADR-058) maintenant** — écartée : rompt une convention établie deux fois dans ce repo pour économiser une seule constante ; à reconsidérer le jour où 3+ besoins de seuils convergent réellement.
- **Réutiliser `AccountRecoveryRequest` tel quel** (statut générique) — écartée : mélangerait deux domaines métier sans rapport (récupération de compte vs limite de crédit) dans une même table ; le *pattern* est repris, pas la table.
- **Appliquer la hausse immédiatement et la "annuler" si rejetée** — écartée : exposerait temporairement le marchand au-delà du seuil voulu, contraire à l'intention "jamais une décision unilatérale" ; la demande reste `pending` et `customer.creditLimit` ne bouge qu'à l'approbation.

## Découpage en tâches bite-sized (2–5 min chacune)

### Schéma & migration
- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — ajouter `approver` à `enum OrganizationRole`
- [ ] Tâche 2 : `packages/db/prisma/schema.prisma` — ajouter `creditLimitApprovalThreshold BigInt? @map("credit_limit_approval_threshold")` sur `Organization`
- [ ] Tâche 3 : `packages/db/prisma/schema.prisma` — ajouter `enum CreditLimitChangeStatus { pending approved rejected }` + modèle `CreditLimitChangeRequest` (id, customerId, organizationId, requestedByUserId, currentLimit, requestedLimit, status, requestedAt, resolvedAt, resolvedByUserId) + relations sur `User` (`creditLimitRequestsMade`/`creditLimitRequestsResolved`), `Customer` (`creditLimitRequests`), `Organization` (`creditLimitRequests`)
- [ ] Tâche 4 : nouvelle migration `packages/db/prisma/migrations/20260818XXXXXX_add_credit_limit_approval/migration.sql` (`ALTER TYPE OrganizationRole ADD VALUE 'approver'`, `CREATE TYPE CreditLimitChangeStatus`, `ALTER TABLE organization ADD COLUMN credit_limit_approval_threshold BIGINT`, `CREATE TABLE credit_limit_change_request`)

### RBAC — nouvelle source d'id
- [ ] Tâche 5 : `apps/trust-api/src/common/rbac/organization-id-source.decorator.ts` — ajouter `"credit-limit-request"` à l'union
- [ ] Tâche 6 : `apps/trust-api/src/common/rbac/roles.guard.ts` — ajouter la branche de résolution `credit-limit-request` → `creditLimitChangeRequest.findUnique` → `organizationId` (404 explicite si absent, même style que les autres branches)

### DTOs
- [ ] [P] Tâche 7 : `apps/trust-api/src/customers/dto/propose-credit-limit.dto.ts` — `{ newLimit: z.coerce.bigint().nonnegative() }`
- [ ] [P] Tâche 8 : `apps/trust-api/src/customers/dto/resolve-credit-limit-request.dto.ts` — `{ decision: z.enum(["approved", "rejected"]) }`

### Constante de seuil
- [ ] [P] Tâche 9 : `apps/trust-api/src/customers/credit-limit-approval.ts` — export `DEFAULT_CREDIT_LIMIT_APPROVAL_THRESHOLD = 10_000_000n`

### Service
- [ ] Tâche 10 : `customers.service.ts` — `proposeCreditLimit(customerId, newLimit, requestedByUserId)` : applique immédiatement si `newLimit - current <= threshold`, sinon crée `CreditLimitChangeRequest` pending
- [ ] Tâche 11 : `customers.service.ts` — `resolveCreditLimitRequest(requestId, resolverUserId, decision)` : bloque l'auto-résolution, transaction `updateMany` sur `pending` (garde de concurrence), applique `creditLimit` si `approved`

### Controller
- [ ] Tâche 12 : `customers.controller.ts` — `POST :id/credit-limit` (`@Roles("owner","admin")`, `@OrganizationIdSource("customer")`)
- [ ] Tâche 13 : `customers.controller.ts` — `POST credit-limit-requests/:requestId/resolve` (`@Roles("approver")`, `@OrganizationIdSource("credit-limit-request")`)

## Tests à écrire AVANT le code
- [ ] `roles.guard.spec.ts` : idSource `credit-limit-request` résout l'organizationId de la demande ; 404 si demande introuvable
- [ ] `customers.service.spec.ts` : hausse ≤ seuil → appliquée immédiatement, pas de `CreditLimitChangeRequest` créée
- [ ] `customers.service.spec.ts` : hausse > seuil → `creditLimit` du client INCHANGÉ, une `CreditLimitChangeRequest` `pending` créée avec le bon `currentLimit`/`requestedLimit`
- [ ] `customers.service.spec.ts` : baisse (même importante) → toujours appliquée immédiatement, jamais de demande créée
- [ ] `customers.service.spec.ts` : seuil non défini sur l'organisation → fallback sur `DEFAULT_CREDIT_LIMIT_APPROVAL_THRESHOLD`
- [ ] `customers.service.spec.ts` : `resolveCreditLimitRequest` avec `decision: "approved"` → `creditLimit` mis à jour au `requestedLimit`, statut `approved`
- [ ] `customers.service.spec.ts` : `decision: "rejected"` → `creditLimit` inchangé, statut `rejected`
- [ ] `customers.service.spec.ts` : demandeur == résolveur → `ConflictException`, aucun changement de statut
- [ ] `customers.service.spec.ts` : double résolution concurrente (statut déjà non-`pending`) → `ConflictException`
- [ ] `propose-credit-limit.dto.spec.ts` : rejette `newLimit` négatif, coerce une string numérique
- [ ] `resolve-credit-limit-request.dto.spec.ts` : rejette une valeur hors `["approved","rejected"]`

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant dans ce document
- Tous les tests verts
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- `dev-code-reviewer` OK
- `dev-domain-model-reviewer` OK (nouveau statut `CreditLimitChangeStatus`, invariant "pending → approved/rejected, jamais l'inverse")
- `dev-test-quality-analyzer` OK (couverture des cas limites : seuil exact, égalité, concurrence)

## Risques identifiés & mitigations
- Risque 1 : deux résolutions concurrentes sur la même demande (double approbation ou approbation+rejet simultanés) → mitigation : `updateMany` filtré sur `status: "pending"` dans une transaction, exactement comme `resolveRecovery()` — la seconde requête trouve `count === 0` et échoue proprement.
- Risque 2 : un utilisateur avec le rôle `approver` mais sans membership actif (`revokedAt` posé) approuve quand même → mitigation : `RolesGuard` vérifie déjà `!membership.revokedAt` pour toute route `@Roles()`, aucun code additionnel requis ici.
- Risque 3 : seuil egal exactement à l'augmentation (`increase === threshold`) mal interprété (`>` vs `>=`) → mitigation : test dédié sur la valeur exacte du seuil, règle retenue explicitement `increase <= threshold` → application immédiate (le seuil lui-même n'exige pas d'approbation, seul le dépassement l'exige).
