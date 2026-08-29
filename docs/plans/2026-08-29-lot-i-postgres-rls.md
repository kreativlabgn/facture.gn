# Plan : Lot I — Row-Level Security PostgreSQL par organisation (C2, Vague 2)

## Contexte projet
- Module : Platform Context (isolation multi-tenant au niveau base) — packages/db + trust-api
- Persona affecté : toutes les PME (isolation de leurs données) ; ops (rollout)
- Données sensibles : TOUTES les tables tenant (factures, paiements, clients, clés…)
- Impact réglementaire : Loi L/2016/037/AN (protection des données) — défense en
  profondeur au-delà des filtres applicatifs `organizationId` + RBAC

## Clarifications
- Q: activer RLS immédiatement (FORCE) ? → R: **non**. La migration pose des
  politiques **no-op tant que `app.current_org_id` n'est pas défini** :
  `USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = …)`.
  `ENABLE` sans `FORCE` → le propriétaire de table (rôle actuel) bypasse de
  toute façon. Effet réel = uniquement après création d'un rôle applicatif
  non-propriétaire + `SET`/`FORCE`, étape de rollout supervisée (runbook).
- Q: câbler l'interception dans tous les services ? → R: **non**. Blast radius de
  ~1200 tests qui mockent Prisma. **Révision en cours de route** : abandon aussi
  de l'interceptor ALS et de `ScopedPrismaService` — la résolution fiable de
  l'org pour CHAQUE route dupliquerait la logique complexe de `RolesGuard`.
  Adoption = explicite par appel : `organizationScopedClient(this.prisma, orgId)`
  là où le service connaît déjà son `orgId` (c'est-à-dire partout). Ce lot livre
  donc : migration dormante + helper unit-testé + ADR + runbook. Zéro câblage,
  zéro régression possible.
- Q: couverture des tables ? → R: 18 tables à `organization_id` direct +
  `organization` + indirectes claires (`invoice_line`, `invoice_event`,
  `payment` via `invoice_id`). Ambiguës reportées phase 2 :
  `pending_member_invite` (XOR org/practice), `product_stock` (double parent),
  tables scoped-practice.
- Non vérifiable sans Postgres → politiques dormantes + helper unit-testé (mock)
  + validation réelle = étape gate du runbook sur staging. Décision user : on assume.

## Problème
L'isolation multi-tenant repose à 100 % sur des `where: { organizationId }`
applicatifs + `RolesGuard`. Un seul oubli de filtre (déjà arrivé — audit
23/08, `listMine()` exposait `bankAccountDetails`) = fuite cross-organisation.
Le DAT exige RLS Postgres « par organisation et par cabinet/CGA ».

## Solution retenue
1. **Migration** `20260829150000_enable_row_level_security` : `ENABLE ROW LEVEL
   SECURITY` + `CREATE POLICY org_isolation` sur chaque table couverte. Prédicat
   avec garde `current_setting(...) IS NULL` → dormant par défaut.
2. **`packages/db`** : `organizationScopedClient(client, organizationId)` —
   extension Prisma `$allOperations` qui exécute chaque opération dans un
   `$transaction([ set_config('app.current_org_id', orgId, true), query(args) ])`
   (`is_local=true` = portée transaction). Exporté par `@facture-gn/db`.
3. **`apps/trust-api/src/common/rls/`** :
   - `organization-context.ts` — `AsyncLocalStorage`, `runWithOrganization`,
     `currentOrganizationId`.
   - `organization-context.interceptor.ts` — `APP_INTERCEPTOR` global : lit
     l'org résolue (même logique que `RolesGuard.resolveOrganizationId`) et
     exécute le handler dans le contexte ALS. **Ne fait que peupler** — aucun
     service ne lit encore le contexte, donc zéro changement de comportement.
   - `scoped-prisma.service.ts` — fournit un client org-scoped quand
     `RLS_ENABLED=true` + contexte présent, sinon le client nu. Injectable, non
     injecté (adoption opt-in).
4. **ADR-111** (V/) + **`docs/runbooks/rls-rollout.md`** (création du rôle
   `facture_app`, `GRANT`, bascule `DATABASE_URL`, `FORCE`, validation).
5. `.env.example` : `RLS_ENABLED=false`.

## Alternatives écartées
- **FORCE RLS immédiat** : casserait l'app (rôle actuel = propriétaire, aucun
  `SET` fait nulle part) et non testable ici.
- **Extension enveloppant chaque requête dans une transaction interactive** :
  `query()` de `$allOperations` est lié au client de base, pas à `tx` — la forme
  `$transaction([...])` (array) est le pattern qui fonctionne réellement.
- **Câblage global de `ScopedPrismaService`** : blast radius ingérable sans
  validation DB.
- **RLS par cabinet/CGA (practice)** : phase 2 — modèle d'accès mandat plus
  complexe (un cabinet voit N organisations).

## Découpage
- [ ] migration SQL (dormante) — 21 tables
- [ ] `packages/db/src/rls.ts` — `organizationScopedClient` + `set_config` SQL
- [ ] `packages/db/src/index.ts` — réexport
- [ ] `packages/db` : `db:generate` + `build`
- [ ] `apps/trust-api/src/common/rls/organization-context.ts`
- [ ] `apps/trust-api/src/common/rls/organization-context.interceptor.ts`
- [ ] `apps/trust-api/src/common/rls/scoped-prisma.service.ts`
- [ ] `apps/trust-api/src/common/rls/rls.module.ts` (+ import dans AppModule)
- [ ] `.env.example` + `docs/runbooks/rls-rollout.md`
- [ ] ADR-111 (V/)

## Tests AVANT le code
- [ ] `rls.spec.ts` (packages/db) : `organizationScopedClient` émet
  `set_config('app.current_org_id', <orgId>, true)` puis l'opération, dans un
  seul `$transaction` array ; rejette un orgId vide.
- [ ] `organization-context.spec.ts` : `runWithOrganization` isole les contextes
  imbriqués ; `currentOrganizationId()` = undefined hors contexte.
- [ ] `organization-context.interceptor.spec.ts` : peuple le contexte depuis
  `params.id` / `params.organizationId` ; ne casse pas si aucune org résoluble.
- [ ] `scoped-prisma.service.spec.ts` : client nu si `RLS_ENABLED` absent ;
  client scoped si `RLS_ENABLED=true` + contexte.
- [ ] `.integration.spec.ts` skip-sans-`DATABASE_URL` : 2 orgs, un client scoré
  sur A ne voit jamais les factures de B (validation réelle, CI/staging).
- [ ] smoke DI trust-api toujours vert (nouvel interceptor global).

## Critères de done
- Migration dormante (aucun `FORCE`, garde `IS NULL`) — vérifié par relecture SQL
- Helper + contexte + interceptor unit-testés
- smoke DI vert, lint + typecheck clean, suite complète sans régression
- ADR-111 + runbook écrits
- Mémoire à jour

## Risques & mitigations
- **Politique SQL fausse (non testable ici)** → garde `IS NULL` = dormant ;
  activation = étape gate sur staging avec Postgres réel (runbook).
- **Interceptor global casse le smoke DI / la perf** → il ne fait qu'un
  `als.run()` synchrone autour du handler, aucune I/O ; testé.
- **`$transaction([...])` + `set_config` : sémantique `SET LOCAL`** → `is_local`
  = `true` explicitement ; documenté.
- **PgBouncer transaction-mode** → `SET LOCAL`/`set_config(...,true)` est
  compatible transaction-pooling (contrairement à `SET` de session) — noté ADR.
- **Tables non couvertes = fausse sécurité** → ADR liste explicitement les
  exclusions et la phase 2.
