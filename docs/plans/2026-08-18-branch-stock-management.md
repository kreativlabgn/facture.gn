# Plan : E10 — Gérer les niveaux de stock par succursale

## Contexte projet
- Module : Trust Context — nouveaux modules `apps/trust-api/src/products` et `apps/trust-api/src/product-stock`
- Persona affecté : `inventory_manager` (nouveau rôle, ADR-097), aussi owner/admin
- Données sensibles manipulées : aucune PII. `cost_price` est une donnée commercialement sensible (marge) — jamais exposée aux endpoints de cette story.
- Impact réglementaire : aucun

## Clarifications
- Q: `PRODUCT` n'existe dans aucun code — quelle story le crée ? → R: **Aucune** (recherche exhaustive du Backlog : E1-E10, aucune story "créer un produit"). E6 et E7 supposent silencieusement son existence, comme E10. Un endpoint minimal de création est construit ici comme prérequis (même pattern que l'invitation d'organisation, F14) : `name` uniquement, restreint owner/admin — `cost_price` (E6) et la consultation de marge (E7) restent des stories séparées, non anticipées ici.
- Q: Faut-il un historique des mouvements de stock (table de ledger) ? → R: **Non** — l'ERD (`PRODUCT_STOCK`) ne porte qu'un `stock_qty` scalaire, aucune entité de mouvement. Rester fidèle à l'ERD plutôt que d'inventer un ledger non demandé (même discipline que le refus de CONFIG_PARAMETER en E5). Le `type` de mouvement (réception/ajustement/perte) sert à valider la cohérence du signe de la variation à la requête, jamais persisté séparément.
- Q: "Consultation des seuils bas" (ADR-097) — construite ici ? → R: **Non** — ni l'ERD (`PRODUCT_STOCK` n'a pas de champ seuil) ni le Backlog E10 lui-même (qui ne mentionne que réception/ajustement/consultation du niveau, pas de seuil configurable) ne la spécifient. Seule la mention terse d'ADR-097 l'évoque, insuffisant pour construire un champ de schéma. Hors scope, à traiter par une story dédiée si un seuil devient un champ réel.
- Q: `inventory_manager` peut-il créer des produits ? → R: **Non** — le Backlog scope explicitement `inventory_manager` aux mouvements de stock ("rattaché à PRODUCT_STOCK.stock_qty"), jamais au catalogue produit lui-même. Création de produit réservée owner/admin.
- Q: Un stock qui devient négatif (perte mal enregistrée) doit-il être bloqué ? → R: **Non** — aucun plancher appliqué, même philosophie que "un stock insuffisant n'a jamais bloqué l'émission d'une facture" et que `cost_price` nullable (ADR-084, "jamais un mur silencieux").
- Q: Contrainte d'unicité `(productId, branchId)` sur `PRODUCT_STOCK` — l'ERD ne la mentionne pas explicitement, l'ajouter quand même ? → R: **Oui** — invariant nécessaire pour qu'"le niveau de stock actuel" soit une valeur unique et non ambiguë ; sans elle, deux lignes concurrentes pour le même produit+succursale rendraient `stock_qty` incohérent.

## Problème (en 3 lignes max)
Une PME multi-succursales n'a aujourd'hui aucun moyen d'enregistrer ses niveaux de stock par succursale dans facture.gn — ni `PRODUCT`, ni `PRODUCT_STOCK` n'existent en code malgré leur présence dans l'ERD, la forçant à dépendre d'un tableur externe.

## Solution retenue (en 5 lignes max)
Nouveaux modèles `Product` et `ProductStock` (fidèles à l'ERD, `@@unique([productId, branchId])` ajoutée). Rôle `inventory_manager` ajouté. `POST /products` (owner/admin, prérequis minimal) crée un produit. `POST /branches/:id/product-stock/:productId/movements` (owner/admin/inventory_manager) applique un mouvement signé (`reception`/`adjustment`/`loss`, validé pour cohérence de signe) via upsert atomique sur `stock_qty`. `GET /branches/:id/product-stock` liste les niveaux par succursale — `cost_price` structurellement absent de toute réponse de ce module.

## Alternatives écartées
- **Table d'historique des mouvements (ledger)** — écartée : non présente dans l'ERD, scope creep non demandé.
- **Champ de seuil bas configurable** — écartée : aucun support ERD, mention Backlog insuffisante.
- **`inventory_manager` peut créer des produits** — écartée : hors du scope explicite du Backlog pour ce rôle.
- **3 endpoints séparés (reception/adjustment/loss)** — écartée : un seul endpoint avec `type` + delta signé, validé pour cohérence, plus simple à tester et maintenir qu'une triplication.

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] [P] Tâche 1 : `packages/db/prisma/schema.prisma` — ajouter `inventory_manager` à `enum OrganizationRole`
- [ ] [P] Tâche 2 : `packages/db/prisma/schema.prisma` — modèle `Product` (id, organizationId, name, taxExemptionCategory nullable, costPrice nullable bigint) + relation `Organization.products`
- [ ] [P] Tâche 3 : `packages/db/prisma/schema.prisma` — `enum StockMovementType { reception adjustment loss }` + modèle `ProductStock` (id, productId, branchId, stockQty nullable int, `@@unique([productId, branchId])`) + relations `Product.stocks`, `Branch.productStocks`
- [ ] Tâche 4 : migration `packages/db/prisma/migrations/20260818XXXXXX_add_inventory_manager_role_and_products/migration.sql`
- [ ] [P] Tâche 5 : `apps/trust-api/src/products/dto/create-product.dto.ts` — `{ organizationId, name }`
- [ ] [P] Tâche 6 : `apps/trust-api/src/product-stock/dto/record-stock-movement.dto.ts` — `{ type: z.enum(["reception","adjustment","loss"]), quantityDelta: z.number().int() }`
- [ ] Tâche 7 : `apps/trust-api/src/products/products.service.ts` + `products.controller.ts` — `POST /products` (owner/admin)
- [ ] Tâche 8 : `apps/trust-api/src/product-stock/product-stock.service.ts` — `recordMovement(branchId, productId, type, quantityDelta)` : valide la cohérence de signe (reception>0, loss<0, adjustment libre), vérifie que le produit appartient à l'organisation de la succursale (IDOR), upsert atomique
- [ ] Tâche 9 : `apps/trust-api/src/product-stock/product-stock.service.ts` — `listByBranch(branchId)` : jamais `costPrice` dans la projection
- [ ] Tâche 10 : `apps/trust-api/src/product-stock/product-stock.controller.ts` — `POST /branches/:id/product-stock/:productId/movements` et `GET /branches/:id/product-stock` (`@Roles("owner","admin","inventory_manager")`, `@OrganizationIdSource("branch")` déjà existant)
- [ ] Tâche 11 : `apps/trust-api/src/products/products.module.ts`, `apps/trust-api/src/product-stock/product-stock.module.ts`, enregistrement dans `app.module.ts`

## Tests à écrire AVANT le code
- [ ] `create-product.dto.spec.ts` : rejette un nom vide
- [ ] `record-stock-movement.dto.spec.ts` : rejette un `type` hors énumération ; accepte un `quantityDelta` négatif ou positif
- [ ] `products.service.spec.ts` : crée un produit avec `costPrice` non défini (jamais un défaut fabriqué)
- [ ] `product-stock.service.spec.ts` : `recordMovement` avec `type: "reception"` et `quantityDelta` négatif → rejeté (incohérence de signe)
- [ ] `product-stock.service.spec.ts` : `recordMovement` avec `type: "loss"` et `quantityDelta` positif → rejeté
- [ ] `product-stock.service.spec.ts` : `recordMovement` avec `type: "adjustment"` accepte les deux signes
- [ ] `product-stock.service.spec.ts` : première réception sur un produit/succursale sans ligne existante → crée `ProductStock` avec `stockQty` = delta (pas d'erreur sur upsert initial)
- [ ] `product-stock.service.spec.ts` : mouvement sur un produit n'appartenant PAS à l'organisation de la succursale → `NotFoundException` (IDOR)
- [ ] `product-stock.service.spec.ts` : une perte ramenant `stockQty` sous zéro n'est jamais bloquée
- [ ] `product-stock.service.spec.ts` : `listByBranch` ne retourne jamais `costPrice`

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant dans ce document
- Tous les tests verts
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- `dev-code-reviewer` OK
- `dev-domain-model-reviewer` recommandé (nouveau type `StockMovementType` avec règle de cohérence de signe — vérifier que l'invariant est appliqué structurellement, pas seulement documenté)

## Risques identifiés & mitigations
- Risque 1 : `productId` d'une autre organisation utilisé via l'URL d'une succursale où l'appelant est légitimement habilité (IDOR) → mitigation : vérification explicite `product.organizationId === branch.organizationId` dans le service, même discipline que `revokeApiKey()` (F15) et `merge()` (E4).
- Risque 2 : incohérence de signe (ex. "réception" avec un delta négatif) créant un mouvement qui ment sur sa propre nature → mitigation : validation explicite dans le service, testée pour les 3 types.
- Risque 3 : `cost_price` fuite accidentellement via `listByBranch` (ex. un futur `include` Prisma trop large) → mitigation : projection explicite des champs retournés, jamais un `include: { product: true }` brut.
