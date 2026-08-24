# Product catalog — index Product + GET /products(/:id) + UI liste/détail

Traite explicitement, sur demande directe de l'utilisateur, deux gaps produit
antérieurement classés "hors scope" :

1. Aucun index Prisma sur `Product(organizationId, name)` — `ProductsService.create()`
   (E3/E10, ADR-038) fait un `findFirst` non indexé sur ces deux colonnes à chaque
   création (voir `packages/db/prisma/schema.prisma:698-713`).
2. Aucune UI produit (ni liste, ni détail) et aucun `GET /products`/`GET /products/:id`
   côté backend — seuls `POST /products` (E10) et `POST /products/:id/cost-price` (E6)
   existent (`apps/trust-api/src/products/products.controller.ts`).

## Périmètre explicitement exclu

Pas de fusion de produits. `ProductsService.merge()` n'existe pas et ne sera pas créé —
décision E3 déjà actée : le Backlog demande la fusion (`merge()`) UNIQUEMENT pour les
clients (E4). L'écran détail produit affiche le signal `possibleDuplicateOf` de façon
purement informative (nom lisible du candidat doublon, sans action).

## Backend

1. **Index** — `@@index([organizationId, name])` sur `model Product` dans
   `schema.prisma`, migration écrite à la main
   (`packages/db/prisma/migrations/20260824100000_add_product_organization_id_name_index/migration.sql`),
   même format que `20260823130000_add_customer_phone_index`. Nom d'index attendu par
   Prisma (convention déjà observée dans ce repo, ex.
   `invoice_organization_id_number_key`) : `product_organization_id_name_idx`.

2. **`GET /products`** — `ProductsService.findAllByOrganization(organizationId, {take, skip})`,
   même convention `DEFAULT_LIST_PAGE_SIZE=50`/`MAX_LIST_PAGE_SIZE=100` que
   `CustomersService.findAllByOrganization`. `Product` n'a pas de champ `createdAt`
   (contrairement à `Customer`) → `orderBy: { name: "asc" }` (s'appuie directement sur
   le nouvel index composite). Route `@Get()` sur `ProductsController`, même
   `organizationScopedListQuerySchema` partagé, mêmes rôles que `create()`
   (`owner`, `admin` — E10 : catalogue produit jamais ouvert à `inventory_manager`).

3. **`GET /products/:id`** — `ProductsService.findOneWithDuplicate(id)`, même pattern que
   `CustomersService.findOneWithBalance` : `findUniqueOrThrow` + `include: { duplicateOf:
   { select: { id: true, name: true } } }`. Pas d'agrégat de solde ici (aucun équivalent
   `runningBalance` pour un produit). Route `@Get(":id")`, `@OrganizationIdSource("product")`
   (déjà branché dans `roles.guard.ts`, réutilisé tel quel — utilisé aujourd'hui par
   `setCostPrice`), mêmes rôles que `create()`.

TDD strict : tests de service d'abord (`products.service.spec.ts`), même style que les
tests `findAllByOrganization`/`findOneWithBalance` existants dans
`customers.service.spec.ts`.

## Frontend

1. **`apps/web/src/lib/trust-api.ts`** — ajoute `ProductListItem`, `listProducts()`,
   `ProductDetail`, `getProduct()`, même forme que `CustomerListItem`/`listCustomers()`/
   `CustomerDetail`/`getCustomer()`. `costPrice` en centimes GNF sérialisé string
   (comme `creditLimit`), nullable.

2. **`apps/web/src/app/dashboard/products/page.tsx`** — même structure que
   `customers/page.tsx` : liste scopée à `organizations[0]`, colonnes `name`, `costPrice`
   formaté via `formatGnf` si renseigné (sinon `—`), badge `DuplicateWarningPill` si
   `possibleDuplicateOf`. Pas de formulaire de création (hors périmètre demandé — la
   création existe déjà côté API mais aucun écran n'est demandé ici).

3. **`apps/web/src/app/dashboard/products/[id]/page.tsx`** — même structure que
   `customers/[id]/page.tsx` (gestion 404/403 via `TrustApiError`), sans
   `MergeDuplicateForm` : le signal de doublon est affiché en lecture seule avec un lien
   texte vers `/dashboard/products/{duplicateOf.id}`, jamais de bouton d'action.

4. **Nav** — `apps/web/src/app/dashboard/layout.tsx`, `NAV_ITEMS` : ajoute
   `{ href: "/dashboard/products", label: "Produits" }` juste après `"Clients"`, même
   position logique (catalogue de vente, à côté du client).

## Séquence

1. `schema.prisma` + migration écrite à la main → `db:generate` → `db:build`.
2. TDD `ProductsService.findAllByOrganization` / `findOneWithDuplicate`.
3. Controller (`@Get()`, `@Get(":id")`).
4. `trust-api.ts` (types + fetchers).
5. Écrans liste/détail + nav.
6. Tests/typecheck/lint trust-api et web.
