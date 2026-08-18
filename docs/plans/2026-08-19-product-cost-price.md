# Plan : E6 — Renseigner le coût d'achat d'un produit

## Contexte projet
- Module : Trust Context — `apps/trust-api/src/products` (extension du module créé par E10)
- Persona affecté : owner/admin (donnée commerciale sensible — marge)
- Données sensibles manipulées : `cost_price` — jamais exposée à `inventory_manager` (ADR-084, déjà appliqué en E10 dans `listByBranch()`)
- Impact réglementaire : aucun

## Clarifications
- Q: Qui peut renseigner `cost_price` ? → R: Le Backlog ne le précise pas explicitement ("en tant qu'organisation"). **owner/admin uniquement**, cohérent avec la restriction déjà posée sur `POST /products` (E10) et avec la sensibilité de la donnée (ADR-084 réserve la lecture de marge à owner/admin/business_manager — écrire le coût source de cette marge suit la même logique restrictive).
- Q: Quelle route RBAC ? → R: `POST /products/:id/cost-price` — `/products` est plat (pas de nesting organisation/succursale), donc nouvelle source `@OrganizationIdSource("product")` sur `RolesGuard`, même pattern que l'ajout de `"customer"`/`"credit-limit-request"` (E5).
- Q: `cost_price` peut-il être remis à `null` (retiré) après avoir été renseigné ? → R: Non demandé par le Backlog ("renseigner", jamais "retirer") — hors scope, `costPrice` accepte une valeur positive ou nulle (0), jamais `null` explicite via cet endpoint.

## Problème (en 3 lignes max)
`Product.costPrice` existe en base (E10) mais aucun endpoint ne permet de le renseigner après la création du produit — une organisation ne peut donc jamais suivre sa marge.

## Solution retenue (en 5 lignes max)
`POST /products/:id/cost-price` (owner/admin) définit `costPrice` sur un produit existant. Nouvelle source `@OrganizationIdSource("product")` sur `RolesGuard` (résout l'organisation depuis le produit ciblé, jamais depuis un `organizationId` de body usurpable — même faille déjà corrigée ailleurs).

## Alternatives écartées
- **Autoriser `inventory_manager` à renseigner `cost_price`** — écartée : contredit directement ADR-084 ("inventory_manager ne voit jamais cost_price... territoire business_manager").
- **Permettre de remettre `costPrice` à `null`** — écartée : non demandé, le Backlog ne parle que de "renseigner".

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] Tâche 1 : `apps/trust-api/src/common/rbac/organization-id-source.decorator.ts` + `roles.guard.ts` — ajouter la source `"product"`
- [ ] [P] Tâche 2 : `apps/trust-api/src/products/dto/set-cost-price.dto.ts` — `{ costPrice: z.coerce.bigint().nonnegative() }`
- [ ] Tâche 3 : `products.service.ts` — `setCostPrice(productId, costPrice)`
- [ ] Tâche 4 : `products.controller.ts` — `POST :id/cost-price` (`@Roles("owner","admin")`, `@OrganizationIdSource("product")`)

## Tests à écrire AVANT le code
- [ ] `roles.guard.spec.ts` : idSource `"product"` résout l'organizationId du produit ciblé ; 404 si produit introuvable
- [ ] `set-cost-price.dto.spec.ts` : rejette un `costPrice` négatif ; coerce une string numérique
- [ ] `products.service.spec.ts` : `setCostPrice` met à jour `costPrice` sur le produit ciblé, retourne le produit à jour

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant
- Tous les tests verts
- Aucune donnée sensible loggée
- `dev-code-reviewer` OK

## Risques identifiés & mitigations
- Risque 1 : `organizationId` de body usurpé pour contourner le RBAC sur un produit d'une autre organisation → mitigation : `@OrganizationIdSource("product")` résout TOUJOURS depuis `:id` (le produit réel), jamais depuis le body, même discipline que la faille déjà corrigée dans `RolesGuard`.
