# Plan : Différenciation Freemium/Starter/Pro par fonctionnalités (H1, MUST)

## Contexte projet
- Module : Trust Context — cross-cutting sur `branches/`, `organizations/` (inviteMember), `customers/` (proposeCreditLimit, merge)
- Persona affecté : la PME émettrice elle-même (owner/admin qui tente de dépasser les capacités de son palier)
- Données sensibles manipulées : aucune nouvelle
- Impact réglementaire : aucun

## Clarifications
- Q: `CommercialTier` (5 paliers : freemium/starter/pro/enterprise/custom) ne contient pas "Starter Plus" (6ᵉ palier, ADR-106, 17/08). L'ajouter ? → R (défaut retenu) : non — Starter Plus touche aussi `commission-grid.ts` (financier, déjà stable) et n'est pas demandé par H1 lui-même. Gap documenté, à traiter en story séparée si demandé explicitement.
- Q: Quelles fonctionnalités de la grille §2 sont réellement gatables ? → R : uniquement celles qui existent en code aujourd'hui — succursales (limite de nombre), collaborateurs (limite de nombre), disponibilité de rôles avancés (inventory_manager / business_manager+approver+auditor / developer_api), "gestion client avancée" (credit_limit + merge doublons). Récurrence, rappels auto, branding, export UBL, analytics avancé n'existent nulle part dans ce repo (I1/I2 non livrées, pas de branding/UBL/analytics avancé construits) — non gatés, gate impossible sur du code inexistant.
- Q: Export FEC et `customer:flag_public_entity` sont-ils gatés ? → R : non, la Grille §2.1 les déclare explicitement ouverts à tous les paliers dès Freemium (conformité DGI) — aucun changement à ces endpoints.
- Q: Quelle exception lever en cas de dépassement de palier ? → R (défaut) : `ForbiddenException` — sémantiquement "non autorisé par votre palier actuel", cohérent avec le pattern RBAC existant (RolesGuard lève aussi `ForbiddenException`), message actionnable citant le palier requis.
- Q: Palier par défaut si `Organization.commercialTier` est freemium et qu'un owner tente d'assigner un rôle avancé à lui-même à la création (premier membre, `role: "owner"`) ? → R : hors scope — `owner` est toujours assignable (rôle de base, jamais gaté), seul `inviteMember()` (rôles autres que owner) est concerné.

## Problème (en 3 lignes max)
La Grille des Offres (§1.1, §2) acte que la différenciation commerciale se fait exclusivement par les fonctionnalités débloquées, jamais par un plafond de volume — mais aucun code n'applique cette différenciation. Une organisation Freemium peut aujourd'hui créer un nombre illimité de succursales, inviter un nombre illimité de collaborateurs avec n'importe quel rôle (y compris `approver`, `auditor`, `developer_api`), sans jamais être incitée à upgrader.

## Solution retenue (en 5 lignes max)
Nouveau fichier `apps/trust-api/src/common/plan-features-grid.ts` (même pattern que `commission-grid.ts`/`revenue-share-grid.ts` : grille hardcodée, pas de CONFIG_PARAMETER) définissant, par `CommercialTier` : `MAX_BRANCHES`, `MAX_MEMBERS`, et le palier minimum requis par rôle avancé (`MIN_TIER_FOR_ROLE`) + pour la gestion client avancée. `BranchesService.create()` et `OrganizationsService.inviteMember()` comptent les entités actives existantes et lèvent `ForbiddenException` au-delà du plafond ; `inviteMember()` valide en plus que le rôle demandé est débloqué par le palier de l'organisation. `CustomersService.proposeCreditLimit()`/`merge()` exigent Pro+.

## Alternatives écartées
- **CONFIG_PARAMETER générique (ADR-058)** — écarté, jamais scaffoldée dans ce repo, 3ᵉ précédent déjà établi (commission-grid.ts, tax-regime.ts, revenue-share-grid.ts) pour ce type de donnée.
- **Nouveau champ `Organization.plan` séparé de `commercialTier`** — écarté : `commercialTier` existe déjà, est déjà la source de vérité commerciale (utilisé par `commission-grid.ts`), le dupliquer créerait deux sources de vérité désynchronisables (une organisation Pro pour la commission mais Freemium pour les fonctionnalités n'a aucun sens métier).
- **Gater aussi Export FEC / `flag_public_entity`** — écarté, la Grille §2.1 les déclare explicitement universels (conformité DGI), gater serait une régression fonctionnelle contraire à la doc commerciale elle-même.

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] [P] Tâche 1 : créer `apps/trust-api/src/common/plan-features-grid.ts` — `MAX_BRANCHES_BY_TIER`, `MAX_MEMBERS_BY_TIER` (`Record<CommercialTier, number | null>`, `null` = illimité), `MIN_TIER_FOR_ROLE: Partial<Record<OrganizationRole, CommercialTier>>`, `ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER`, fonctions `isRoleAllowedForTier()`, `isBelowOrEqualTier()` (ordre des paliers)
- [ ] Tâche 2 : `BranchesService.create()` — compter les succursales existantes de l'organisation, `ForbiddenException` si `MAX_BRANCHES_BY_TIER[tier]` atteint
- [ ] Tâche 3 : `OrganizationsService.inviteMember()` — compter les membres actifs, `ForbiddenException` si plafond atteint ; valider `dto.role` via `isRoleAllowedForTier()`, `ForbiddenException` sinon
- [ ] Tâche 4 : `CustomersService.proposeCreditLimit()` et `merge()` — `ForbiddenException` si palier < `ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER`
- [ ] Tâche 5 : vérifier non-régression complète sur `branches.service.spec.ts`, `organizations.service.spec.ts` (inviteMember), `customers.service.spec.ts` (proposeCreditLimit, merge) — tous les tests existants doivent rester verts avec `commercialTier: "pro"` ou supérieur dans leurs fixtures si nécessaire

## Tests à écrire AVANT le code
- [ ] `plan-features-grid.spec.ts` : `isRoleAllowedForTier("inventory_manager", "freemium")` → false, `("inventory_manager", "starter")` → true ; `("approver", "starter")` → false, `("approver", "pro")` → true ; `("owner", "freemium")` → true (rôles de base toujours autorisés)
- [ ] `branches.service.spec.ts` : création refusée en Freemium au-delà de 1 succursale active (`ForbiddenException`) ; acceptée en Starter jusqu'à 2 ; illimitée en Pro+
- [ ] `organizations.service.spec.ts` : invitation refusée au-delà du plafond de collaborateurs du palier ; invitation avec un rôle non débloqué par le palier refusée même si le plafond de collaborateurs n'est pas atteint
- [ ] `customers.service.spec.ts` : `proposeCreditLimit()` et `merge()` refusés en Freemium/Starter, acceptés en Pro+

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant dans ce document
- Tous les tests verts (nouveaux + non-régression complète)
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- code-reviewer OK
- domain-model-reviewer OK (nouvelle notion de palier de fonctionnalités, invariants à vérifier)

## Risques identifiés & mitigations
- Risque 1 : régression sur les 3 services déjà stables (`branches`, `inviteMember`, `customers`) → mitigation : gate ajouté comme garde d'entrée précoce (avant toute mutation), jamais une réécriture de la logique existante ; suite de tests existante entièrement rejouée avant merge.
- Risque 2 : incohérence si `Starter Plus` (ADR-106) est ajouté plus tard sans revoir cette grille → mitigation : commentaire explicite dans `plan-features-grid.ts` documentant le gap et pointant vers ce PLAN.md.
