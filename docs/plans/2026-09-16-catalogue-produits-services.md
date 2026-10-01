# Plan : Catalogue produits/services — champs métier (2026-09-16)

**Statut : plan + schéma + migration livrés par le solution-architect ; service NestJS,
contrôleur, DTO complets et formulaire web restent à faire (backend-developer /
frontend-developer), à partir du contrat ci-dessous.**

## Contexte

Le fondateur veut pouvoir décrire un catalogue interne (espace connecté marchand
uniquement) de **produits ET services**, avec un descriptif court, un prix de
vente optionnel (« pas forcément une boutique » — certains services PME sont
sur devis) et la possibilité de retirer un article discontinué sans casser
l'historique de facturation.

**Décision produit déjà actée, non rouverte ici** (product-manager) : ce
catalogue reste strictement interne à `apps/web/src/app/(app)/dashboard/products/**`.
Aucune vitrine publique, aucune découverte, aucun classement de vendeurs —
conforme à ADR-101 (Registre-ADR, Partie 16 : « facture.gn reste
infrastructure, jamais opérateur de marketplace ») et au DAT §2.3 (« Catalogue »
classé Capital Context, V2, non scaffoldé). Ce chantier n'ajoute que des champs
au modèle `Product` du Trust Context déjà scaffoldé et un endpoint d'édition —
rien côté Capital.

`Product` existe déjà (E10, `packages/db/prisma/schema.prisma` l.1036 avant ce
chantier) avec `id, organizationId, name, taxExemptionCategory (jamais
consommé), costPrice (BigInt?, territoire E6/ADR-084 — jamais montré à un
client), possibleDuplicateOf`. `POST /products` (création minimale) et
`POST /products/:id/cost-price` (`setCostPrice`, dédié) existent déjà dans
`apps/trust-api/src/products/`. Aucun endpoint d'édition générale n'existe.

## Clarifications déjà tranchées par product-manager (ne pas rouvrir)

1. **Champs à ajouter sur `Product`** : `description` (nullable, borné),
   prix de vente nullable en centimes GNF, type produit/service (enum,
   obligatoire à la création, seul champ structurel requis en plus de `name`),
   statut actif/inactif (`Boolean @default(true)`).
2. **RBAC inchangé** : création et édition réservées `owner`/`admin` — même
   trio que `POST /products` existant. Lecture (liste + détail, prix de vente
   inclus) inchangée dans ce chantier, `owner`/`admin` uniquement — le
   prix de vente n'est pas une donnée de marge comme `costPrice`, mais
   `findAllByOrganization`/`findOneWithDuplicate` renvoient l'entité Prisma
   complète, `costPrice` inclus ; élargir la lecture sans filtrage de champs
   ferait fuiter `costPrice` (ADR-084). Différé, pas construit ici.
3. **`costPrice` reste exclusivement sur `POST /products/:id/cost-price`** —
   jamais fusionné avec le nouvel endpoint d'édition, même si l'écran web
   présente les deux dans un seul formulaire visuel (deux appels API).
4. **Explicitement hors scope** : `taxExemptionCategory` (aucun consommateur,
   domaine de valeurs non cadré — story fiscale séparée), unité de mesure
   (aucun équivalent nulle part dans le schéma actuel), préremplissage d'une
   ligne de facture depuis le catalogue (non-goal déjà écarté par le
   fondateur).

## Problème

`Product` ne permet aujourd'hui de représenter ni un descriptif, ni un prix de
vente, ni la distinction produit physique / service, ni un statut actif/inactif
— et aucun endpoint ne permet de corriger un produit après sa création (seul
`costPrice` a un endpoint dédié). Sans le champ `type`, `ProductStock` (déjà en
base) n'a de fondement métier explicite : rien n'empêche aujourd'hui de créer
des mouvements de stock pour ce qui devrait être un service.

## Solution retenue

### 1 — Schéma (`packages/db/prisma/schema.prisma`, model `Product` uniquement)

Nouvel enum, placé juste avant `model Product` (convention déjà suivie dans ce
fichier — `NotificationChannel` juste avant `model Customer`) :

```prisma
enum ProductType {
  product
  service
}
```

Deux valeurs seulement, casse alignée sur les enums existants (`OrganizationRole`,
`PracticeMemberRole`, `CommissionBypassLevel` : snake_case minuscule).

Champs ajoutés au model `Product` (noms Prisma → colonnes SQL) :

| Champ Prisma | Type Prisma | Colonne SQL | Nullable | Défaut |
|---|---|---|---|---|
| `description` | `String?` | `description` | oui | — |
| `type` | `ProductType` | `type` | **non** | — (voir migration : `DEFAULT 'product'` temporaire, retiré) |
| `salePrice` | `BigInt?` | `sale_price` | oui | — |
| `isActive` | `Boolean` | `is_active` | non | `true` |

- `description` : pas de longueur en base (`@db.VarChar` n'est utilisé nulle
  part ailleurs dans ce schéma — cohérence délibérée), borné à la couche API
  (Zod `max(500)`, même longueur que `create-pdp-invoice.dto.ts:description`,
  précédent direct dans ce dépôt).
- `salePrice` : nom choisi pour ne jamais se confondre avec `costPrice` (E6,
  ADR-084) au moment de la lecture du schéma ou du code — même unité (centimes
  GNF, `BigInt`) que `costPrice`/`InvoiceLine.unitPrice`. Nullable : catégorie
  « sur devis » du Backlog fondateur.
- `type` : NOT NULL en base — c'est le seul champ « obligatoire à la
  création » demandé. Le schéma Prisma ne porte **aucun** `@default(...)` sur
  ce champ (contrairement à `isActive`) : ça le laisse *requis* dans le type
  TypeScript généré (`Prisma.ProductCreateInput`), donc `createProductSchema`
  ne peut pas l'omettre sans que `ProductsService.create()` échoue déjà à la
  compilation si jamais il oubliait de le passer. Voir §3 pour la garde
  d'immuabilité.
- `isActive` : `@default(true)` côté Prisma **et** DB — toute ligne existante
  et tout futur `INSERT` sans mention explicite reste active par défaut, ce
  qui est le comportement actuel implicite (rien n'était jamais « inactif »
  avant ce chantier).

Aucun autre model touché. `ProductStock`/`InvoiceLine` restent inchangés.

### 2 — Migration (`packages/db/prisma/migrations/20260916140000_product_catalog_fields/migration.sql`)

Écrite à la main (pas de base d'ombre disponible sur ce poste pour
`prisma migrate diff`, même contrainte que `20260909020000_saisie_regime`).
Contenu (résumé — voir le fichier pour les commentaires complets) :

```sql
CREATE TYPE "ProductType" AS ENUM ('product', 'service');

ALTER TABLE "product" ADD COLUMN     "description" TEXT,
ADD COLUMN     "sale_price" BIGINT,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- DEFAULT temporaire pour les lignes déjà existantes (tout le catalogue créé
-- jusqu'ici l'a été implicitement comme un produit physique — seul sens
-- disponible avant ce chantier, cohérent avec ProductStock déjà en base pour
-- certaines de ces lignes), retiré aussitôt — même séquence que
-- 20260809210000_add_mandate_initiated_by (mandate.initiated_by).
ALTER TABLE "product" ADD COLUMN     "type" "ProductType" NOT NULL DEFAULT 'product';
ALTER TABLE "product" ALTER COLUMN "type" DROP DEFAULT;
```

RLS : rien à ajouter. `product` est sous `ENABLE` + `FORCE ROW LEVEL SECURITY`
depuis `20260829150000`/`20260907020000` ; une politique porte sur la LIGNE,
jamais sur la liste des colonnes — les colonnes ajoutées sont couvertes par
`org_isolation` dès leur création (même raisonnement déjà vérifié pour
`invoice_line.saisie_regime`). Aucune nouvelle table, donc aucun `GRANT`
supplémentaire.

**Vérifié** : `pnpm --filter db db:generate` puis `pnpm --filter db build`
passent tous les deux sans erreur (le client Prisma généré expose bien
`Prisma.ProductType`, `Product.type` en `$Enums.ProductType` non-nullable, et
`packages/db/dist` a été reconstruit).

### 3 — Garde sur le changement de type : immuabilité structurelle, pas de logique runtime

**Décision : `type` est immuable après création.** Écarté : bloquer l'update
si des lignes `ProductStock` existent pour ce produit (plus de code, plus de
tests dédiés, et laisse un trou métier — que fait-on d'un produit qui a *eu*
du stock puis plus aucune ligne `ProductStock` restante ? La question ne se
pose jamais avec l'immuabilité).

Mécanisme retenu — **structurel, pas un `if` de garde** : `updateProductSchema`
(§4) ne déclare tout simplement pas de champ `type`. Une requête PATCH qui
inclurait `"type": "service"` dans son corps JSON verrait cette clé
silencieusement ignorée par Zod (comportement par défaut de `z.object()`,
sans `.strict()`) — **exactement le même mécanisme, déjà en production dans ce
dépôt**, que `commercialTier`/`dgiVerificationStatus`/`accountCode` explicitement
exclus de `updateOrganizationSchema` (`apps/trust-api/src/organizations/dto/update-organization.dto.ts`,
commentaire « Ce qui N'EST PAS modifiable ici, à dessein »). `UpdateProductDto`
(le type TypeScript inféré) n'aura pas de propriété `type` : il est donc
*impossible à la compilation* que `ProductsService.update()` transmette ce
champ à Prisma, même par erreur d'implémentation future. Aucun endpoint,
présent ou futur dans ce chantier, n'expose de mutation de `type` — la
question « silencieux » ne se pose plus, il n'y a structurellement aucun
chemin.

`backend-developer` doit reprendre ce commentaire (ou équivalent) dans
`update-product.dto.ts` pour que l'intention reste explicite, pas seulement
déductible de l'absence du champ.

### 4 — Contrat API

Deux routes sur `ProductsController` (`apps/trust-api/src/products/`) :

#### a) `POST /products` — DTO étendu (fichier existant `create-product.dto.ts`)

**Décision : `create-product.dto.ts` accepte directement `type` (obligatoire),
`description` et `salePrice` (optionnels) — la création n'est PAS minimale.**
Motivation : `type` doit de toute façon être fourni dès la création (seul
champ structurellement requis en plus de `name`, §Clarifications point 1) —
il n'y a donc pas de version « minimale » possible qui l'omettrait. Une fois
`type` obligatoire dans le formulaire de création, refuser `description`/
`salePrice` au même moment forcerait systématiquement un aller-retour
« créer puis éditer immédiatement » pour le cas le plus courant (un marchand
qui remplit fiche produit complète en une fois) — contraire à l'intention du
fondateur (« un seul formulaire »). `isActive` n'est PAS accepté à la création
(toujours `true` par défaut, `@default(true)` côté DB) : rien ne justifie de
créer un produit déjà désactivé, c'est un concept de cycle de vie propre à
l'édition, pas à la naissance d'une fiche.

```ts
// create-product.dto.ts
export const createProductSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(["product", "service"]),
  description: z.string().trim().min(1).max(500).optional(),
  salePrice: z.coerce.bigint().nonnegative().optional(),
});
export type CreateProductDto = z.infer<typeof createProductSchema>;
```

- Route : `POST /products` (inchangée)
- Rôles : `owner`, `admin` (inchangé)
- Succès : `201 Created` (comportement Nest par défaut sur `@Post()`), corps =
  entité `Product` créée (inclut désormais `type`, `description ?? null`,
  `salePrice ?? null`, `isActive: true`, en plus des champs déjà existants).
- Erreurs :
  - `400 Bad Request` — `type` manquant/hors énum, `name` vide, `description`
    vide après trim ou > 500 caractères, `salePrice` négatif ou non numérique
    (corps : `{ statusCode: 400, message: <ZodError flatten()> }`, format
    existant de `ZodValidationPipe`, inchangé).
  - `401 Unauthorized` — pas de bearer token valide (inchangé).
  - `403 Forbidden` — authentifié mais rôle hors `owner`/`admin` (inchangé).

#### b) `PATCH /products/:id` — nouvelle route, nouveau DTO `update-product.dto.ts`

```ts
// update-product.dto.ts
export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    // `null` explicite = effacer le champ, distinct de `undefined` = ne pas y
    // toucher — même convention que nif/etaxNumber/rccm dans
    // updateOrganizationSchema. `salePrice: null` fait redevenir un produit
    // "sur devis".
    description: z.string().trim().min(1).max(500).nullable().optional(),
    salePrice: z.coerce.bigint().nonnegative().nullable().optional(),
    isActive: z.boolean().optional(),
    // "type" ABSENT ICI À DESSEIN — immuable après création, voir plan
    // docs/plans/2026-09-16-catalogue-produits-services.md §3.
  })
  .refine((data) => Object.values(data).some((valeur) => valeur !== undefined), {
    message: "Aucun champ à modifier",
  });
export type UpdateProductDto = z.infer<typeof updateProductSchema>;
```

Contrôleur (même trio et même mécanique que `setCostPrice`/`findOne` déjà en
place sur ce contrôleur) :

```ts
@Patch(":id")
@Roles("owner", "admin")
@OrganizationIdSource("product")
update(
  @Param("id") id: string,
  @Body(new ZodValidationPipe(updateProductSchema)) dto: UpdateProductDto,
  @CurrentOrganizationId() organizationId: string,
) {
  return this.productsService.update(id, dto, organizationId);
}
```

Service (même squelette que `OrganizationsService.update()` — spread
conditionnel par champ, `undefined` = ne pas toucher, `null` explicite passé
tel quel à Prisma pour effacer) :

```ts
async update(productId: string, dto: UpdateProductDto, organizationId: string) {
  const scoped = organizationScopedClient(this.prisma, organizationId);
  await scoped.product.findFirstOrThrow({ where: { id: productId, organizationId } });
  return scoped.product.update({
    where: { id: productId },
    data: {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.salePrice !== undefined ? { salePrice: dto.salePrice } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    },
  });
}
```

- Route : `PATCH /products/:id` (nouvelle)
- Rôles : `owner`, `admin`, résolution `organizationId` via
  `@OrganizationIdSource("product")` (mécanisme déjà branché dans
  `roles.guard.ts` — réutilisé tel quel, déjà utilisé par `setCostPrice`/`findOne`).
- Succès : `200 OK`, corps = entité `Product` mise à jour (forme identique à
  `GET /products/:id`, `costPrice`/`possibleDuplicateOf` inclus, inchangés
  par cette route).
- Erreurs :
  - `400 Bad Request` — corps vide (`.refine` « Aucun champ à modifier »),
    `name`/`description` vides après trim, `description` > 500, `salePrice`
    négatif, `isActive` non booléen.
  - `401 Unauthorized` — pas de bearer token valide.
  - `403 Forbidden` — authentifié, membre de la bonne organisation, mais rôle
    hors `owner`/`admin`.
  - `404 Not Found` — `:id` inconnu OU appartenant à une autre organisation
    que celle de l'appelant (`OrganizationIdSource("product")` lève déjà
    `NotFoundException("Ressource introuvable")` dans ce cas précis — masquage
    volontaire, mécanisme existant, pas nouveau ici).

#### c) Ce qui NE change PAS

- `POST /products/:id/cost-price` (`setCostPrice`) — inchangé, seul chemin
  qui renseigne `costPrice`.
- `GET /products` / `GET /products/:id` — inchangés dans leur code, mais leur
  réponse porte désormais aussi `description`, `type`, `salePrice`, `isActive`
  (entité Prisma complète, comme aujourd'hui pour `costPrice`). **Aucun
  filtrage par `isActive` n'est ajouté à `GET /products` dans ce chantier**
  (pas demandé — voir Risques) : la liste renvoie produits actifs et inactifs
  mélangés, à `frontend-developer` de décider de l'affichage.

## Alternatives écartées

- **Bloquer le changement de `type` par une garde runtime** (vérifier
  l'absence de `ProductStock` avant d'autoriser l'update) : écarté au profit
  de l'immuabilité structurelle — plus de code à écrire/tester, et couvre
  aussi bien « jamais eu de stock » que « en a eu puis plus », deux cas que la
  garde runtime aurait dû trancher séparément sans qu'aucune règle métier ne
  soit demandée pour ce second cas.
- **Fusionner `costPrice` dans `PATCH /products/:id`** : écarté, explicitement
  tranché par product-manager — `costPrice` reste un territoire E6/ADR-084 à
  part, avec sa propre traçabilité d'accès (`setCostPrice`), même si l'écran
  web présente les deux dans un seul formulaire visuel.
  Ne construit AUCUN filtrage de champs ni RBAC additionnel — le porter à
  `cashier`/`field_agent` demain, quand un besoin concret existera, plutôt que
  maintenant sans consommateur.
- **`description` avec longueur bornée en base (`@db.VarChar(500)`)** :
  écarté, aucune autre colonne texte de ce schéma ne porte de borne SQL — la
  validation Zod à la couche API est le seul mécanisme de bornage déjà en
  place dans ce dépôt (ex. `create-pdp-invoice.dto.ts`), pas de raison de
  diverger pour ce champ précis.
- **`type` avec un `@default(product)` côté Prisma** : écarté — un défaut
  Prisma rendrait le champ optionnel dans `Prisma.ProductCreateInput`,
  affaiblissant la garantie « obligatoire à la création » au niveau du
  compilateur. Le `DEFAULT` SQL temporaire de la migration (retiré
  immédiatement après backfill) suffit à satisfaire les lignes historiques
  sans relâcher cette garantie pour l'avenir.

## Fichiers et tâches (pour backend-developer / frontend-developer)

Déjà fait par le solution-architect (ce chantier) :

1. `packages/db/prisma/schema.prisma` — enum `ProductType` + 4 champs sur
   `model Product`.
2. `packages/db/prisma/migrations/20260916140000_product_catalog_fields/migration.sql`.
3. `pnpm --filter db db:generate` puis `pnpm --filter db build` — vérifiés,
   passent.

Restant (backend-developer, TDD strict) :

4. `apps/trust-api/src/products/dto/create-product.dto.ts` — ajouter `type`
   (obligatoire), `description`, `salePrice` (§4a). Étendre
   `create-product.dto.spec.ts` en RED d'abord.
5. `apps/trust-api/src/products/dto/update-product.dto.ts` — nouveau fichier
   (§4b) + `update-product.dto.spec.ts`.
6. `apps/trust-api/src/products/products.service.ts` — `create()` passe
   `type`/`description`/`salePrice` à Prisma ; nouvelle méthode `update()`
   (§4b). Étendre `products.service.spec.ts` en RED d'abord (cas : mise à
   jour partielle, effacement explicite de `description`/`salePrice` via
   `null`, refus 404 hors organisation, `type` absent du DTO donc jamais
   modifiable même si testé explicitement).
7. `apps/trust-api/src/products/products.controller.ts` — route `PATCH :id`
   (§4b).

Restant (frontend-developer, hors périmètre de ce plan pour le détail UI) :

8. `apps/web/src/app/(app)/dashboard/products/**` — formulaire de création
   (type/description/prix de vente) et d'édition, respectant la Charte
   Graphique v1.3 (`globals.css`/`layout.tsx`, tokens `navy-*`/`yellow`,
   jamais `#FBB500`). Le prix de vente affiché en `font-mono` uniquement s'il
   s'agit d'un montant déjà certifié/figé — ici c'est une donnée éditable de
   catalogue, donc `font-sans`/`font-display`, pas `font-mono` (réservé aux
   identifiants déjà certifiés par la Charte).

## Périmètre exclu — rappel explicite

Chantiers parallèles en cours dans ce dépôt, **ne pas y toucher** dans le
prolongement de ce plan :

- `apps/trust-api/src/ussd/**`
- `apps/trust-api/src/payments/payments.service.ts`
- `apps/trust-api/src/invoices/invoices.service.ts`
- `apps/web/src/lib/route-protection.ts`
- `apps/web/src/app/cabinet/**`
- `apps/web/src/app/portail/**`

## Critères de done

- `packages/db/prisma/schema.prisma` : `model Product` porte `description`,
  `type` (`ProductType`), `salePrice`, `isActive` ; aucun autre model modifié.
- Migration `20260916140000_product_catalog_fields` appliquée proprement
  (`db:generate` + `db build` verts, déjà vérifié ici).
- `create-product.dto.ts` exige `type`, accepte `description`/`salePrice`
  optionnels ; `update-product.dto.ts` existe, n'accepte jamais `type`.
- `PATCH /products/:id` réservé `owner`/`admin`, 404 masqué hors organisation
  (même mécanisme que `setCostPrice`), `costPrice` toujours hors de son
  périmètre.
- `pnpm --filter trust-api lint typecheck test build` passent après
  l'implémentation backend.
- Aucun fichier du périmètre exclu ci-dessus modifié.
- Aucun commit — working tree laissé pour relecture (ce plan + schéma +
  migration seuls livrés par le solution-architect).

## Risques et limites

- **`GET /products` ne filtre pas `isActive`** dans ce chantier — un
  marchand avec beaucoup de produits discontinués verra une liste mélangée
  tant qu'un tri/filtre n'est pas construit côté `frontend-developer` (sur les
  données déjà disponibles, aucun changement serveur requis pour un simple
  filtrage côté client sur une page déjà chargée ; un filtrage serveur
  paginé resterait un chantier séparé si le volume le justifie un jour).
- **Lecture non élargie** : `cashier`/`field_agent` ne voient toujours aucun
  produit, y compris son prix de vente désormais disponible — différé par
  product-manager, pas un oubli.
- **Dette non corrigée ici** (notée pour information) : le commentaire actuel
  de `products.controller.ts` mentionne un territoire `business_manager` en
  lecture sur `costPrice`, jamais réellement branché via
  `OrganizationAccessService.assertAccess()` (mécanisme utilisé par
  `margin.controller.ts` pour ce rôle). Hors périmètre de ce chantier.
- **`salePrice` et `costPrice` coexistent sur la même entité** — tout code
  futur qui logue ou sérialise un `Product` entier doit continuer à exclure
  `costPrice` des sorties visibles côté client (CONTRIBUTING.md, jamais un
  enregistrement Prisma entier dans un log) ; `salePrice`, lui, n'a pas cette
  contrainte.
