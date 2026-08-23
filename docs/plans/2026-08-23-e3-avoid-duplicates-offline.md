# E3 — Éviter les doublons client/produit en offline

Backlog ligne 231 : **E3 — Éviter les doublons client/produit en offline `[SHOULD]`** — Réf ADR-038.
ADR-038 : « Dédoublonnage : jamais de fusion automatique. `possible_duplicate_of`, résolution
manuelle. » Backlog ligne 238 précise explicitement la frontière avec E4 (déjà livrée) :
« E3 prévient les doublons en offline, E4 résout ceux déjà créés ».

## Contexte et preuve du périmètre réel

Exploration de `apps/web` : aucune infrastructure offline dédiée n'existe dans ce repo
(`find apps/web -iname "*offline*" -o -iname "*sync*" -o -iname "*queue*"` → aucun résultat).
Pas de service worker de synchronisation, pas de queue de mutations différées, pas de détection
en ligne/hors ligne. Construire une vraie infra de sync CRDT (mentionnée dans le contexte
Money Layer du projet) est hors de portée réaliste pour cette story SHOULD — aucune fondation
n'existe sur laquelle greffer un mécanisme de dédoublonnage "spécifique à l'offline".

Le seul chemin réellement exploitable : le backend ne distingue JAMAIS une création "online"
d'une création rejouée après une coupure — les deux traversent le même `POST /customers` (et
`POST /products`). Preuve directe dans `apps/trust-api/src/customers/customers.service.ts` :
- `importCustomers()` (E9, déjà livrée) applique un dédoublonnage par téléphone — contre la
  base existante ET contre le lot en cours — et pose `possibleDuplicateOf`, jamais de fusion
  automatique (commentaire ligne 202-206, déjà conforme à ADR-038).
- `create()` (chemin unitaire, ligne 35-47) ne fait AUCUN dédoublonnage. C'est LE gap : un
  agent terrain qui ressaisit un client après une coupure réseau (le scénario "offline" concret
  de cette story) passe forcément par ce chemin unitaire, jamais par l'import en masse.

**Réduction de scope actée** : E3 = appliquer à `CustomersService.create()` le même filet de
sécurité par téléphone qu'`importCustomers()` applique déjà, pour que peu importe le chemin
(unitaire ou lot, online ou rejoué après une coupure), le signal `possibleDuplicateOf` soit posé
de façon uniforme. C'est la seule interprétation actionnable sans construire une infra offline
complète que rien dans ce repo ne prépare.

Même gap symétrique côté produit : `apps/trust-api/src/products/products.service.ts::create()`
(E10, déjà livrée) ne fait aucun dédoublonnage. `Product` n'a PAS de champ
`possibleDuplicateOf` dans `schema.prisma` (contrairement à `Customer`, ligne 745-791) — champ à
ajouter, même pattern (auto-relation nullable, jamais de contrainte bloquante).

## Décisions de conception actées

1. **`CustomersService.create()` — dédoublonnage par téléphone, contre la base existante de
   l'organisation uniquement** (pas de "lot en cours" ici : une seule ligne, contrairement à
   `importCustomers()`). `phone` est déjà normalisé E.164 par `msisdnSchema` au niveau DTO →
   comparaison exacte, même logique qu'`importCustomers()`. Aucun dédoublonnage si `phone` est
   absent (comme `importCustomers()` : `possibleDuplicateOf` reste `null`).
2. **Produit — dédoublonnage par `name`, exact match insensible à la casse, contre la base
   existante de l'organisation.** `name` est le seul champ obligatoire d'un produit (`cost_price`
   est du territoire E6, renseigné séparément, jamais à la création — E10 déjà livrée).
   Justification du seuil "exact match insensible à la casse" plutôt qu'une similarité floue
   (Levenshtein, trigrammes) : ADR-038 dit explicitement "jamais de fusion automatique, juste un
   signal" — un signal approximatif produirait du bruit (faux positifs sur "Riz 25kg" vs
   "Riz 50kg") sans bénéfice supplémentaire pour une résolution manuelle. Cohérent avec le choix
   déjà fait pour `Customer` (dédoublonnage par téléphone = match exact, pas de fuzzy matching
   sur le nom du client).
3. **`Product.possibleDuplicateOf` ajouté au schéma, même pattern que `Customer`** (auto-relation
   nullable `@relation("ProductDuplicate")`, `possibleDupes Product[]`) plutôt qu'un signal
   éphémère non persisté dans la réponse API. Raison : cohérence structurelle avec `Customer`
   (même story, même ADR, même mécanisme) et persistance nécessaire pour qu'une future story de
   résolution (symétrique à E4, hors scope ici) puisse s'appuyer dessus sans migration
   supplémentaire — exactement le pattern déjà choisi pour `Customer.possibleDuplicateOf`
   (posé par E9, consommé plus tard par E4).
4. **Pas de `ProductsService.merge()`.** Le Backlog ne mentionne la fusion QUE pour les clients
   (E4, ligne 235-240) — aucune story n'étend explicitement la fusion aux produits. Ajouter une
   fusion produit serait une extension de périmètre non demandée. Le champ
   `possibleDuplicateOf` reste donc, pour l'instant, un pointeur informatif sans consommateur —
   cohérent avec ADR-038 ("jamais de fusion automatique") : le signal existe, la résolution
   manuelle (si un jour demandée) sera une story distincte.
5. **Aucune infra offline construite** (pas de queue, pas de détection online/offline, pas de
   nouvel écran PWA). Le filet de sécurité par téléphone/nom s'applique de façon identique à
   TOUTE création, qu'elle soit "en direct" ou "rejouée après une coupure" — c'est précisément
   ce qui rend le mécanisme robuste à l'offline sans avoir besoin de le détecter explicitement.
6. **Pas de nouvelle permission.** Le dédoublonnage est un comportement automatique de
   `create()`, pas une action distincte — le trio de rôles existant (owner/admin/
   accountant_internal/cashier/field_agent pour customers ; owner/admin pour products) reste
   inchangé.
7. **Pas de changement frontend.** `apps/web/src/app/dashboard/customers/NewCustomerForm.tsx`
   est le seul écran de création concerné, et aucun écran ne consomme déjà
   `possibleDuplicateOf` côté web (recherche `grep -rl "possibleDuplicateOf|duplicate"
   apps/web/src` → aucun résultat, même pour E4 déjà livrée). Surfacer le signal dans l'UI est
   donc un gap préexistant qui dépasse E3 (E3 ne construit pas plus côté web qu'E4 ne l'a fait
   côté client) — hors scope ici, cohérent avec "reste minimal".

## Fichiers touchés

- `packages/db/prisma/schema.prisma` — ajout `Product.possibleDuplicateOf` + relation
  `ProductDuplicate` (symétrique à `CustomerDuplicate`).
- `packages/db/prisma/migrations/<timestamp>_add_product_possible_duplicate_of/migration.sql`
  — nouvelle migration.
- `apps/trust-api/src/customers/customers.service.ts` — `create()` dédoublonne par téléphone.
- `apps/trust-api/src/customers/customers.service.spec.ts` — tests TDD pour le nouveau
  comportement de `create()`.
- `apps/trust-api/src/products/products.service.ts` — `create()` dédoublonne par nom
  (insensible à la casse).
- `apps/trust-api/src/products/products.service.spec.ts` — tests TDD pour le nouveau
  comportement de `create()`.

## Séquence TDD

1. RED : test `CustomersService.create()` pose `possibleDuplicateOf` quand le téléphone matche
   un client existant de l'organisation ; reste `null` sinon ou si organisation différente.
2. GREEN : implémentation minimale dans `create()`.
3. RED : migration schema (`Product.possibleDuplicateOf`), `pnpm --filter @facture-gn/db
   db:generate` puis `build`.
4. RED : test `ProductsService.create()` pose `possibleDuplicateOf` quand le nom matche
   (insensible à la casse) un produit existant de l'organisation ; reste `null` sinon.
5. GREEN : implémentation minimale dans `create()`.
6. REFACTOR si besoin, puis lint/typecheck/tests complets.
