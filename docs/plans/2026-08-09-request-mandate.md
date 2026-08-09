# Plan : Demander un mandat sur une organisation (F5, ADR-069)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — nouveau périmètre `mandates/`, dépend de `practices/` (F4, mergée)
- Persona affecté : comptable agréé (Mamadou) ou responsable CGA qui veut obtenir l'accès comptable à une organisation cliente
- Données sensibles manipulées : aucune nouvelle (relation d'accès, pas une donnée personnelle/financière en tant que telle)
- Impact réglementaire : aucun direct pour cette story (la demande elle-même ne donne encore aucun accès — `status: pending`)

## Investigation préalable
Backlog (texte complet) : "En tant que comptable ou CGA, je veux demander l'accès comptable à un client, afin de consulter ses factures et exporter son FEC. - POST /practices/{id}/mandates - Acceptation via PWA ou *620# (option 5.3 + PIN). Réf : ADR-069."

ADR-069 (texte exact) : "Mandat (practice → organization) remplace membership individuelle. Accordé à l'entité cabinet, pas à un individu. Révocation par cabinet = tous les collaborateurs perdent l'accès. Turnover géré proprement. Acceptation explicite obligatoire (PWA ou *620# option 5.3 + PIN). Conséquences : Audit enrichi : « user X du cabinet/practice Y a consulté »."

ERD-facture-gn.md (section MANDATE, source de vérité canonique) :
```
MANDATE : id, practice_id (FK), organization_id (FK), status (pending/active/revoked/expired), granted_role (accountant_external/business_manager), permissions_override (jsonb nullable), granted_by (FK USER, owner/admin qui a accepté), requested_at, granted_at (nullable), expires_at (nullable), revoked_at (nullable).
```

**Découverte corrigeant l'heuristique de sélection** : le grep initial qui a motivé cette story s'appuyait sur `InvoiceEventType.mandate_requested/mandate_granted/mandate_revoked/mandate_expired`, scaffoldés et jamais utilisés. Investigation : `InvoiceEvent.invoiceId` est une FK **obligatoire** vers `Invoice` (`model InvoiceEvent`, ligne 512) — un mandat n'a structurellement aucune facture associée (il relie `practice_id` à `organization_id`), donc ces valeurs d'enum ne peuvent physiquement pas être consommées par cette story ni par F1/F6. La story F5 reste pleinement justifiée par le texte backlog + ADR-069 lus directement — mais son audit trail sera porté par les propres champs horodatés de `MANDATE` (`requestedAt`/`grantedAt`/`revokedAt`), exactement le précédent déjà établi pour `CreditNote` (C7) : "l'entité est déjà sa propre trace d'audit complète, jamais un `InvoiceEvent` redondant." Les 4 valeurs `mandate_*` de `InvoiceEventType` restent scaffoldées-mais-inertes après cette story — limitation documentée, pas un oubli.

**Découverte bloquante pour le scope** : F1 ("inviter", initié par le propriétaire d'organisation) et F5 ("demander", initié par le cabinet) sont deux points d'entrée distincts du backlog convergeant vers le même mécanisme d'acceptation ("Acceptation explicite obligatoire", ADR-069) — mais **aucune story backlog visible ne construit explicitement l'action d'acceptation elle-même** (ni F1 ni F5 ne la détaillent au-delà de la mentionner). Construire l'acceptation (PWA ou *620# option 5.3 + PIN) dans cette story dupliquerait un mécanisme que F1 devra de toute façon couvrir dans l'autre sens — et le canal USSD PIN est une brique Spec-USSD entièrement séparée (même raisonnement que l'exclusion USSD déjà appliquée cette session). **F5 se limite donc strictement à la création de la demande** (`status: pending`) ; l'acceptation (`status: active`, `grantedBy`/`grantedAt` renseignés) est explicitement hors scope, réservée à une story future (F1 ou une story d'acceptation dédiée).

## Problème (en 3 lignes max)
Aucun modèle `MANDATE` n'existe — ADR-069 établit le mandat comme mécanisme exclusif d'accès multi-organisation pour un cabinet/CGA (F4, mergée) mais rien ne permet aujourd'hui à un cabinet de seulement *demander* cet accès.

## Solution retenue (en 5 lignes max)
Nouveau modèle `Mandate` (fidèle à l'ERD) et route `POST /practices/:id/mandates` (`:id` = practice). Aucun `@Roles()` (RolesGuard est entièrement scopé aux `OrganizationRole`, structurellement hors sujet ici — un mandat est une action *practice*-scopée, pas organisation-scopée) : autorisation vérifiée en ligne dans le service (l'appelant doit être `PracticeMember` de la practice ciblée, rôle `practice_admin`), même précédent que `OrganizationsService.createAssisted()` qui vérifie `isFieldAgent` en ligne plutôt que via `RolesGuard`. Garde anti-doublon : aucune nouvelle demande si un mandat `pending` ou `active` existe déjà pour le couple (practiceId, organizationId) — mêmes précédent que les gardes anti-sur-crédit (C7) / anti-sur-remboursement (C13). `grantedRole` restreint à `accountant_external` uniquement au MVP (ADR-070 : `business_manager` reste V1) — champ scaffoldé fidèlement dans le schema Prisma (les deux valeurs), mais le DTO Zod n'en accepte qu'une pour l'instant.

## Alternatives écartées
Construire l'action d'acceptation (`status: pending → active`) dans la même story — écartée : ni F1 ni F5 ne la détaillent explicitement dans le backlog, et le canal *620# PIN est une brique USSD séparée (Spec-USSD-facture-gn.md), hors scope MVP de cette story précise ; une story future (F1 ou dédiée) la couvrira. Écrire un `InvoiceEvent(mandate_requested)` pour la traçabilité — écartée : `InvoiceEvent.invoiceId` est une FK obligatoire, un mandat n'a pas de facture associée ; les champs horodatés de `Mandate` (`requestedAt`) sont déjà la trace complète (précédent C7). Étendre `RolesGuard`/`@OrganizationIdSource` pour couvrir ce cas — écartée : le guard existant résout exclusivement une organisation via `OrganizationMember`, un `PracticeMember` est un concept RBAC entièrement distinct (ADR-068) ; l'vérification en ligne dans le service (précédent `createAssisted()`) est plus simple et n'entraîne aucun risque de régression sur les routes existantes.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — enum `MandateStatus` {pending, active, revoked, expired}, enum `MandateGrantedRole` {accountant_external, business_manager}, modèle `Mandate` (fidèle à l'ERD) ; relations `mandates Mandate[]` sur `ProfessionalPractice` et sur `Organization` ; migration manuelle
- [ ] Tâche 2 : `apps/trust-api/src/mandates/dto/create-mandate.dto.ts` (nouveau) — `organizationId: z.string().uuid()`, `grantedRole: z.enum(["accountant_external"])` (MVP-restreint, ADR-070)
- [ ] Tâche 3 : `apps/trust-api/src/mandates/mandates.service.ts` (nouveau) — `create(practiceId, dto, requesterUserId)` : vérifie `PracticeMember(practiceId, requesterUserId, role: practice_admin)` en ligne (`ForbiddenException` sinon), vérifie l'organisation cible existe (`NotFoundException` sinon), garde anti-doublon (`ConflictException` si mandat `pending`/`active` déjà présent pour ce couple), crée `Mandate(status: pending, requestedAt: now())`
- [ ] Tâche 4 : `apps/trust-api/src/mandates/mandates.controller.ts` + `mandates.module.ts` (nouveaux) — `POST /practices/:id/mandates`, aucun `@Roles()`, `@CurrentUser()` pour le demandeur ; câblage dans `app.module.ts`

## Tests à écrire AVANT le code
- [ ] Test 1 (`create-mandate.dto.spec.ts`) : `organizationId` mal formé (pas un UUID) → rejeté
- [ ] Test 2 : `grantedRole: "business_manager"` → rejeté (ADR-070, hors scope MVP)
- [ ] Test 3 (`mandates.service.spec.ts`) : mandat créé avec `status: pending`, `requestedAt` renseigné, `grantedAt`/`grantedBy`/`revokedAt`/`expiresAt` tous `null`
- [ ] Test 4 : refuse si l'appelant n'est pas `PracticeMember` de la practice ciblée
- [ ] Test 5 : refuse si l'appelant est `PracticeMember` mais pas `practice_admin` (ex. `accountant_external` ne peut pas engager le cabinet)
- [ ] Test 6 : refuse (404) si l'organisation ciblée n'existe pas
- [ ] Test 7 : refuse (409) si un mandat `pending` existe déjà pour ce couple practice/organisation
- [ ] Test 8 : refuse (409) si un mandat `active` existe déjà pour ce couple practice/organisation
- [ ] Test 9 : accepte une nouvelle demande si le seul mandat existant pour ce couple est `revoked` ou `expired` (états terminaux, jamais bloquants)

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Migration Prisma appliquée et vérifiée
- code-reviewer OK
- domain-model-reviewer recommandé (nouveau modèle avec machine à états `status`, invariants de transition à documenter même si cette story ne construit qu'une seule transition possible : absence → pending)

## Risques identifiés & mitigations
- Risque 1 : un futur `Mandate.status` pourrait transitionner de façon illégale (ex. `revoked → active` directement) une fois F1/F6 construites → mitigation : cette story ne construit qu'une seule écriture (création `pending`), aucune transition ; documenté explicitement comme un risque à surveiller dans les stories futures qui manipuleront `status`.
- Risque 2 : la garde anti-doublon est applicative, pas une contrainte DB (même limitation de concurrence acceptée que C7/C13) → mitigation : documentée, scénario de double-soumission concurrente rare pour une action administrative peu fréquente.
