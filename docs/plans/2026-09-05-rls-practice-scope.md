# Plan : Chantier A — RLS scope practice (cabinet/CGA) — ADR-111 phase 2

## Contexte projet
- Module : Platform Context (isolation multi-tenant au niveau base) — `packages/db`
- Persona : collaborateurs de cabinet comptable / gestionnaire / fiduciaire / CGA
  (`practice_admin`, `accountant_external`, `business_manager`) qui consultent
  plusieurs organisations mandatées ; ops (rollout)
- Données sensibles : toutes les tables tenant, vues cette fois via un mandat
- Impact réglementaire : Loi L/2016/037/AN — défense en profondeur au-delà des
  filtres applicatifs `organizationId` + `RolesGuard` + vérifications de mandat

## Clarifications
- Q : créer les modèles `invoice` / `invoice_event` / la RLS ? → R : **non, ils
  existent déjà** (`schema.prisma`, migrations `20260808…` → `20260831…`, dont
  `20260829150000_enable_row_level_security` et `20260830120000_invoice_event_append_only`).
  Le seul manque réel est le **scope practice**, explicitement reporté « phase 2 »
  par `docs/plans/2026-08-29-lot-i-postgres-rls.md` et par le plan
  `2026-08-09-switch-organization.md`.
- Q : TimescaleDB (mentionné DAT §1) ? → R : hors périmètre — aucune hypertable
  dans le repo, `invoice_event` reste une table B-tree ; à trancher par ADR si le
  volume l'exige un jour.
- Q : activer (FORCE) maintenant ? → R : **non**. Politiques dormantes, activation =
  étape supervisée du runbook (inchangé).
- Non vérifiable sans Postgres de prod → migration validée localement contre
  PostgreSQL 16 (PGlite WASM) : exécution + isolation org + vue practice +
  expiration/révocation de mandat. Validation réelle = gate runbook sur staging.

## Problème
`app.current_org_id` isole par organisation, mais un cabinet mandaté doit voir les
données de **toutes** ses organisations clientes (DAT §7.2 : « Isolation RLS : SET
app.current_practice »). Aujourd'hui cet accès repose à 100 % sur des filtres
applicatifs + la vérification de mandat en ligne — un oubli = fuite cross-tenant,
sans filet base.

## Solution retenue
1. **Migration `20260905120000_rls_practice_scope`** (dormante) :
   - fonction `public.rls_practice_sees_org(text)` — `STABLE`, `SECURITY INVOKER`,
     `search_path=''` : `true` ssi `app.current_practice_id` est posé ET un
     `mandate` `active` non expiré lie ce cabinet à l'org passée.
   - **remplace** (DROP + CREATE, nom `org_isolation` conservé) les 28 politiques
     par une forme **combinée unique** :
     `(org IS NULL AND practice IS NULL)  -- dormant`
     `OR organization_id = current_setting('app.current_org_id', true)`
     `OR public.rls_practice_sees_org(organization_id)`
   - `mandate` / `revenue_share_credit` : branche practice = `practice_id` direct.
     `pending_member_invite` : XOR `organization_id` / `practice_id`.
     Tables indirectes : `EXISTS` sur `invoice` / `credit_note` / `product` avec
     `public.` qualifié (anti-shadow).
2. **`packages/db/src/rls.ts`** : `practiceScopedClient(client, practiceId)`,
   `setPracticeScope(tx, practiceId)`, `RLS_PRACTICE_SETTING`,
   `makePracticeScopedOperation` — miroir exact des variantes org (refactor via
   `makeScopedOperation` privé). Réexport `index.ts`.
3. **`packages/db/prisma/scripts/rls-activate-supabase.sql`** : script manuel
   (éditeur SQL Supabase) transcrivant les étapes 2/4/5 du runbook — `CREATE ROLE
   facture_app`, GRANT (dont `EXECUTE` sur la fonction), FORCE (28 tables),
   REVOKE `invoice_event`. Section 2 commentée par défaut.
4. **Docs** : `rls-rollout.md` (section scope practice, checklist, rollback,
   note rétention, +`bank_transaction` dans la liste FORCE) ; en-tête
   `schema.prisma` rafraîchi (n'était plus « 6 entités »).

## Alternatives écartées
- **2ᵉ politique permissive `practice_isolation`** keyée sur le seul
  `app.current_practice_id` : les politiques permissives sont OU-ées → dès qu'une
  PME normale ne pose que `app.current_org_id`, l'échappement `practice IS NULL`
  de la 2ᵉ politique renvoie `true` pour toutes les lignes et neutralise
  `org_isolation`. Seule une politique combinée unique est correcte.
- **GUC unique `app.current_scope` polymorphe** : perd la capacité de poser les
  deux (cabinet « entré » dans une org précise) et complexifie le helper.
- **RLS sur `professional_practice` / `practice_member`** : jamais exposées
  cross-tenant, `ENABLE` nouvelle = risque hors périmètre.
- **Modifier `schema.prisma`** pour la RLS : Prisma ne modélise pas les policies.

## Découpage
- [x] `packages/db/prisma/migrations/20260905120000_rls_practice_scope/migration.sql`
- [x] `packages/db/src/rls.ts` + `index.ts`
- [x] `packages/db/src/rls.spec.ts` (unit) + `rls.integration.spec.ts` (gate réel)
- [x] `packages/db/prisma/scripts/rls-activate-supabase.sql`
- [x] `docs/runbooks/rls-rollout.md` + en-tête `schema.prisma`
- [x] `prisma validate` (aucune migration distante)
- [ ] Adoption `practiceScopedClient` dans `apps/trust-api` — story séparée
      (comme l'adoption `organizationScopedClient`, non câblée globalement)

## Tests
- Unit (`rls.spec.ts`) : `makePracticeScopedOperation` émet
  `set_config('app.current_practice_id', <id>, TRUE)` puis l'opération dans une
  transaction ; `practiceScopedClient` / `setPracticeScope` rejettent un id vide.
- Intégration (`rls.integration.spec.ts`, `RLS_INTEGRATION_TEST=1`) : un cabinet
  mandaté sur A voit A, jamais une org tierce ; un practiceId sans mandat ne voit
  rien.
- Hors suite CI (pas de Postgres) : `scratchpad/test-rls.mjs` contre PGlite —
  migration exécutée, 28 politiques, dormant/org/practice/expiration/révocation OK.

## Critères de done
- Migration dormante (échappement double-NULL, aucun `FORCE`) — relu + PGlite
- Helpers unit-testés, réexportés
- `prisma validate` vert, lint + typecheck clean, `pnpm turbo test` sans régression
- Runbook + en-tête schéma à jour
- Mémoire projet à jour
