# Runbook — Activation de Row-Level Security PostgreSQL (C2 / ADR-111)

Deux migrations posent les politiques et les laissent **dormantes** :

- `20260829150000_enable_row_level_security` — politiques `org_isolation` par
  **organisation** (GUC `app.current_org_id`).
- `20260905120000_rls_practice_scope` (Chantier A, ADR-111 phase 2) — **remplace**
  ces politiques par une forme combinée qui couvre aussi le scope **practice**
  (GUC `app.current_practice_id` → un cabinet/CGA voit ses organisations à mandat
  `active` non expiré, DAT §7.2), via la fonction `public.rls_practice_sees_org(text)`.

Ce runbook les active, par étapes réversibles, avec un point de validation sur
staging avant la production.

Prérequis : un environnement staging avec un PostgreSQL réel (pas SQLite, pas de
mock), un jeu de données à ≥ 2 organisations, et — pour valider le scope practice —
≥ 1 cabinet avec un mandat `active` sur l'une d'elles.

Raccourci Supabase : `packages/db/prisma/scripts/rls-activate-supabase.sql`
transcrit les étapes 2, 4 et 5 ci-dessous en un script à exécuter dans l'éditeur
SQL Supabase (à lire en parallèle de ce runbook, pas à la place).

## Vue d'ensemble

| État | `FORCE` ? | Rôle applicatif | `app.current_org_id` | Effet |
|---|---|---|---|---|
| Après la migration (défaut) | non | propriétaire des tables | jamais défini | aucun (double garde : bypass propriétaire + échappement `(org IS NULL AND practice IS NULL) OR ...`) |
| Étape 2 (rôle dédié) | non | `facture_app` (non-propriétaire) | défini par `organizationScopedClient` / `practiceScopedClient` | RLS actif pour les requêtes scopées ; les requêtes non scopées voient tout |
| Étape 4 (FORCE) | oui | `facture_app` | défini | RLS actif y compris pour le propriétaire ; une requête non scopée ne voit **rien** |

> **Précision vérifiée le 2026-10-01** (Postgres 16, rôle `facture_app` NOBYPASSRLS, table
> `b2g_case` à deux tenants) : le prédicat `(org IS NULL AND practice IS NULL) OR …` laisse
> passer toute session qui ne pose **aucun** scope — y compris sous `FORCE` et sous le rôle
> non-propriétaire. Une requête sans scope voit **toutes** les lignes (2 sur 2) ; avec
> `app.current_org_id` posé elle ne voit que celles de ce tenant (1 sur 2) ; une chaîne vide
> compte comme « pas de scope ». La phrase « une requête non scopée ne voit rien » du tableau
> ci-dessus décrit donc une cible (« fail-closed »), **pas le comportement actuel**. Tant que
> l'échappement dormant n'est pas retiré, la RLS est une défense en profondeur contre un
> **mauvais scope**, pas contre un **scope oublié** : le filtre applicatif `organizationId`
> reste obligatoire. Retirer l'échappement (une fois tout le code scopé) est un chantier
> distinct, à décider.

### Scope practice (`app.current_practice_id`)

Depuis `20260905120000_rls_practice_scope`, le prédicat dormant exige que **les
deux** GUC soient nuls (une 2ᵉ politique permissive keyée sur le seul
`app.current_practice_id` serait OU-ée avec `org_isolation` et neutraliserait son
filtre dès qu'une PME normale ne pose que `app.current_org_id` — d'où la politique
unique combinée).

| GUC posé | Ce que la connexion voit |
|---|---|
| `app.current_org_id` seul | les données de cette organisation (inchangé) |
| `app.current_practice_id` seul | les données de **toutes** les organisations à mandat `active` non expiré de ce cabinet (vue transversale) |
| les deux | l'organisation ciblée **ou** toute organisation mandatée |

Côté code : `practiceScopedClient(prisma, practiceId)` (ou `setPracticeScope(tx,
practiceId)` dans une transaction interactive), exporté par `@facture-gn/db`, sur
le même modèle que `organizationScopedClient`. `mandate` et `revenue_share_credit`
sont filtrées sur `practice_id` en direct ; `professional_practice` /
`practice_member` restent **hors RLS** (aucune story ne les expose cross-tenant).

### Registre : quelles tables sont sous RLS, lesquelles ne le sont pas

Règle : **toute table qui porte une colonne de tenant** (`organization_id`,
`practice_id`, `cabinet_id`, ou toute colonne `…_organization_id` / `…_practice_id` /
`…_cabinet_id`) est sous `ENABLE` + `FORCE ROW LEVEL SECURITY` avec au moins une
politique — **dans la migration même qui la crée**. Les seules exceptions sont
nommées ci-dessous, avec leur raison.

| Table hors RLS | Colonne de tenant | Pourquoi |
|---|---|---|
| `data_rights_request` | `organization_id` (nullable) | registre cross-organisation (ADR-E2) |
| `practice_member` | `practice_id` | « aucune story ne l'expose cross-tenant » (plan `2026-09-05-rls-practice-scope`) |
| `professional_practice` | — | idem ; aucune colonne de tenant |
| `payment_webhook`, `merkle_anchor_batch` | — | cross-organisation par conception |
| `user`, `user_phone`, `revoked_token`, `client_portal_otp`, `partner`, `financial_partner`, `public_buyer_account`, `public_buyer_account_member` | — | registres d'identité / globaux, sans colonne de tenant |

**Cette règle est vérifiée par un test**, pas seulement écrite :
`apps/trust-api/src/common/rls-registry.integration.spec.ts` interroge `pg_class` et
`pg_policies` sur une base réelle. Il échoue si une table à colonne de tenant n'est pas
enrôlée, et aussi si une exception de sa liste `EXCEPTIONS` devient obsolète. Il a été
écrit après un oubli réel : `b2g_case`, `telemo_award` et `ocaecg_license` (ADR-126) ont
été créées le 17/09 sans politique et corrigées par `20261001090000_rls_b2g_ocaecg_tables`.

**Ajouter une table à colonne de tenant — liste de contrôle**
1. Dans **la même migration** que le `CREATE TABLE` : `ENABLE`, `FORCE`, politique
   `org_isolation FOR ALL` (même prédicat dormant, `USING` **et** `WITH CHECK`), `GRANT …
   TO facture_app` conditionnel — modèle : `20260911120000_ocr_document` (clé
   `organization_id`) ou `20261001090000_rls_b2g_ocaecg_tables`.
2. Le code qui y accède pose `setOrganizationScope` (ou passe par
   `organizationScopedClient`) **avant** le premier accès.
3. Si la table doit rester hors RLS (cross-organisation par conception) : l'ajouter à
   `EXCEPTIONS` dans le test **et** à ce tableau, avec la raison. Le test refuse l'entrée
   sans table correspondante.

## Étape 1 — Adopter `organizationScopedClient` dans le code

Dans chaque service qui lit/écrit des données tenant, remplacer `this.prisma` par
`organizationScopedClient(this.prisma, organizationId)` **là où l'orgId est
connu** (partout où il y a déjà un `where: { organizationId }`).

```ts
// avant
return this.prisma.invoice.findMany({ where: { organizationId, status } });
// après
return organizationScopedClient(this.prisma, organizationId).invoice.findMany({
  where: { organizationId, status },
});
```

> **Ne JAMAIS retirer `organizationId` du `where`.** Une version antérieure de
> ce runbook le faisait dans l'exemple ci-dessus, en s'appuyant sur RLS pour
> filtrer. Tant que l'étape 2 n'est pas faite, les politiques sont dormantes ET
> le rôle applicatif est propriétaire des tables, donc contourne RLS : retirer
> la clause rendrait les données de **toutes** les organisations. Elle devient
> redondante le jour où RLS mord — jamais dangereuse.

Ordre suggéré (du plus sensible au moins) : `invoices`, `payments`, `customers`,
`fiscal-periods`, `products`, le reste. Chaque service migré garde ses tests
verts (le helper n'ajoute qu'une transaction + `set_config`).

**Dans une transaction interactive** (`prisma.$transaction(async (tx) => …)` —
`issue()`, `close()`, la numérotation…), NE PAS utiliser `organizationScopedClient`
(chaque opération y ouvrirait une transaction imbriquée). Appeler à la place, en
première ligne du bloc :

```ts
await prisma.$transaction(async (tx) => {
  await setOrganizationScope(tx, organizationId); // RLS pour tout le reste du bloc
  // … tx.invoice.update(…), tx.invoiceSequence.upsert(…) …
});
```

Tant que l'étape 2 n'est pas faite, `set_config` est inoffensif (le rôle
propriétaire bypasse RLS).

**Dashboard cabinet/CGA** (routes `practices/*`, `mandates/*`) : utiliser
`practiceScopedClient(this.prisma, practiceId)` / `setPracticeScope(tx, practiceId)`
au lieu des variantes org, là où l'accès est délégué par mandat plutôt que direct.
Ne jamais poser les deux GUC pour une même requête sauf « entrée » explicite dans
une organisation précise (le prédicat les OU-e).

### Recette de migration (établie le 2026-09-06 sur `invoices`)

Quatre situations, quatre gestes. Elles couvrent tout ce qui a été rencontré.

**1. Le service reçoit déjà l'organisation** (`findAllByOrganization`, création
depuis un DTO). Envelopper l'appel, garder le `where`.

**2. La méthode est adressée par identifiant** (`findOne(invoiceId)`,
`void`, `issue`…). C'est le cas dominant, et c'était le blocage : le service
relisait la ressource pour découvrir son organisation, lecture non scopée donc
impossible sous RLS. `RolesGuard` avait déjà fait ce travail — il pose
désormais `request.organizationId`, que **`@CurrentOrganizationId()`**
(`common/rbac/current-organization-id.decorator.ts`) transmet au handler. Le
contrôleur le passe au service ; le `where` porte `{ id, organizationId }`.

Corollaire Prisma : `findUniqueOrThrow` devient `findFirstOrThrow` dès que
le `where` porte deux champs — `{ id, organizationId }` n'est pas une clé
unique.

**3. Transaction interactive** (`issue()`, la numérotation…). `*ScopedClient`
y est interdit : chaque opération ouvrirait une transaction imbriquée. Appeler
`setOrganizationScope(tx, organizationId)` en PREMIÈRE ligne du bloc. Si la
transaction contient du SQL brut (`SELECT … FOR UPDATE`), lui ajouter aussi
`AND organization_id = …` : tant que RLS dort, ce verrou porterait sinon sur
la ligne d'un autre locataire.

**4. Appelant hors HTTP** (module `ussd`, files d'attente, tâches planifiées).
Aucun guard ne tourne, donc aucune organisation n'est résolue. Elle doit venir
du contexte de l'appelant — pour l'USSD, du paramètre d'`emitInvoice()`,
lui-même issu de la session authentifiée. **Ne jamais la redécouvrir en relisant
la ressource** : c'est reproduire l'œuf et la poule.

#### Les faux de test

`organizationScopedClient()` appelle `client.$extends()`, et
`setOrganizationScope()` appelle `tx.$executeRaw` — deux méthodes absentes
des faux existants. La tentation est d'ajouter `$extends: () => prisma` : un
faux qui se renvoie lui-même garde les tests verts **sans rien prouver**.

Préférer un faux qui rend un client **distinct** (voir
`createFakeScopedPrisma()` dans `invoices.service.spec.ts`) : un test peut
alors affirmer que la lecture est passée par le client scopé **et pas** par le
client de base. À l'adoption, les assertions existantes se mettent à échouer —
c'est le signe que le faux est fidèle, pas un incident.

#### Ordre et inventaire

~300 appels `this.prisma.<modèle>` sur ~25 modules. Du plus sensible au moins :

| Module | Appels prisma | État |
|---|---|---|
| `invoices` | 28 | partiel — `findAllByOrganization`, `findOne`, `void`, `issue` faits ; restent `regeneratePaymentLink`, `sendReminder`, `convertToInvoice`, `forfeitDeposit` |
| `ussd` | 35 | à faire — hors HTTP, cas 4 |
| `mandates` | 24 | à faire — scope **practice**, pas org |
| `organizations` | 22 | à faire |
| `payments` | 21 | à faire |
| `customers` | 19 | à faire |
| `certification`, `bank-reconciliation`, `public-buyer`, `commission-bypass`, … | ~130 | à faire |

**Ne pas enchaîner sur l'étape 2 avant d'avoir fini l'étape 1.** Créer
`facture_app` (`NOBYPASSRLS`) alors qu'un seul service n'a pas été migré ne
produit pas une erreur : il produit des **écrans vides**, silencieusement, sur
ce service. C'est la panne la plus coûteuse du chantier, parce qu'elle ne
ressemble pas à une panne.

## Étape 2 — Créer le rôle applicatif non-propriétaire (staging)

```sql
CREATE ROLE facture_app LOGIN PASSWORD '<secret depuis le gestionnaire>';
GRANT CONNECT ON DATABASE facture_gn TO facture_app;
GRANT USAGE ON SCHEMA public TO facture_app;
GRANT EXECUTE ON FUNCTION public.rls_practice_sees_org(text) TO facture_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO facture_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO facture_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO facture_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO facture_app;
-- PAS de BYPASSRLS, PAS de SUPERUSER, PAS propriétaire des tables.
```

Les **migrations** continuent de tourner avec le rôle propriétaire actuel
(`DATABASE_URL` de migration distincte de `DATABASE_URL` applicative).

## Étape 3 — Basculer l'application sur `facture_app` (staging)

`DATABASE_URL="postgresql://facture_app:<secret>@.../facture_gn"` pour trust-api
et money-api. Redéployer.

### Validation (bloquante avant la prod)

- [ ] Les deux services démarrent, `/health/ready` vert.
- [ ] Un utilisateur de l'organisation A ne voit aucune donnée de l'organisation
      B via l'API (factures, clients, paiements) — même en forgeant des IDs.
- [ ] Un collaborateur d'un cabinet mandaté sur A voit les données de A via le
      dashboard cabinet, **jamais** celles d'une organisation non mandatée ; la
      révocation / l'expiration du mandat coupe l'accès immédiatement.
- [ ] Le test d'intégration `packages/db` (`RLS_INTEGRATION_TEST=1`) passe —
      `rls.integration.spec.ts` couvre l'isolation org **et** le scope practice.
- [ ] Aucune régression fonctionnelle sur les parcours e2e principaux.
- [ ] Les requêtes NON encore scopées (services pas encore migrés à l'étape 1)
      fonctionnent toujours (RLS non forcé → elles voient tout). Suivre leur
      migration.

## Étape 4 — `FORCE ROW LEVEL SECURITY` (après migration complète du code)

Uniquement quand **tous** les accès tenant passent par `organizationScopedClient`
ou `practiceScopedClient`. Sinon une requête non scopée ne verra plus rien.

```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'account_recovery_request','api_key','assisted_session','bank_transaction',
    'branch','commission_bypass_case','credit_limit_change_request','customer',
    'fiscal_period_closing','invoice','invoice_sequence','mandate',
    'organization_member','organization_signing_key','product',
    'recurring_invoice_template','revenue_share_credit','ussd_session',
    'pending_member_invite','organization','payment','invoice_line',
    'credit_note','invoice_event','refund','payment_provider_attempt',
    'credit_note_line','product_stock'
  ] LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
```

## Étape 5 — Durcir `invoice_event` (défense en profondeur, J1)

Indépendant de la RLS, mais lié au même rôle `facture_app`. La migration
`20260830120000_invoice_event_append_only` pose un **trigger actif** qui refuse
tout `UPDATE`/`DELETE` DML direct sur `invoice_event`, pour tous les rôles. Le
trigger ne couvre PAS `TRUNCATE` ni la désactivation par un rôle disposant du
DDL — d'où cette étape, à exécuter en même temps que la bascule sur `facture_app`
(étape 3) :

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON "invoice_event" FROM facture_app;
```

`facture_app` ne conserve que `SELECT` et `INSERT` (l'application n'ajoute que
des événements). Règles permanentes :

- **Ne jamais `GRANT ALL` sur `invoice_event`** (ré-accorderait UPDATE/DELETE/TRUNCATE).
- `TRUNCATE "invoice" CASCADE` ou `TRUNCATE "organization" CASCADE` détruisent
  `invoice_event` en cascade **sans déclencher le trigger** — interdits hors
  reset d'un environnement de test.
- Vérifier `REVOKE CREATE ON SCHEMA public FROM PUBLIC` sur le cluster de prod
  (défaut PG15+ ; un cluster initialisé sur PG ≤ 14 laisserait `facture_app`
  remplacer `reject_invoice_event_mutation()` par un no-op).

Rollback : `GRANT UPDATE, DELETE ON "invoice_event" TO facture_app;` — sans effet
tant que le trigger est en place.

### Correction exceptionnelle du journal (« bris de glace »)

Le trigger rend `invoice_event` définitivement immuable. Une corruption réelle
(déploiement bugué ayant écrit des événements avec un mauvais `invoice_id` /
`amount` / `metadata`) n'a qu'une remédiation, **exceptionnelle et supervisée** :

1. Autorisation explicite d'un responsable (Squad Trust + conformité) — tracée
   hors SI.
2. Migration one-off dédiée, dans une **transaction unique** :
   ```sql
   ALTER TABLE "invoice_event" DISABLE TRIGGER invoice_event_append_only;
   -- corrections ciblées (UPDATE/DELETE strictement bornés par id)
   ALTER TABLE "invoice_event" ENABLE TRIGGER invoice_event_append_only;
   ```
3. Émettre dans la foulée un `invoice_event` (ou une entrée de journal
   d'exploitation) constatant l'opération : qui, quand, quelles lignes, pourquoi.
4. Vérifier `ENABLE TRIGGER` effectif avant de clore la transaction.

Alerting : router vers Grafana/Loki une alerte sur toute erreur Postgres
`restrict_violation` visant `invoice_event` (taux normal ≈ 0 — une tentative
signale un bug ou un probing).

## Rollback

- Étape 4 → 3 : `ALTER TABLE %I NO FORCE ROW LEVEL SECURITY`.
- Étape 3 → 1 : rebasculer `DATABASE_URL` sur le rôle propriétaire.
- Étape 1 → 0 : les politiques restent en place mais dormantes (rôle
  propriétaire + aucun GUC `app.current_*` défini). Aucun `DROP POLICY`
  nécessaire.
- Annuler `20261001090000_rls_b2g_ocaecg_tables` (tables B2G) : pour chacune de
  `b2g_case`, `telemo_award`, `ocaecg_license` — `DROP POLICY org_isolation ON <table>;`
  puis `ALTER TABLE <table> NO FORCE ROW LEVEL SECURITY;` puis
  `ALTER TABLE <table> DISABLE ROW LEVEL SECURITY;`. Aucune donnée touchée. Le test
  d'exhaustivité redeviendra rouge tant que les tables ne sont pas retirées du registre
  ou ré-enrôlées : c'est voulu.
- Annuler le scope practice seul (revenir aux politiques par organisation de
  `20260829150000`) : rejouer le corps de cette migration (chaque `CREATE POLICY`
  après `DROP POLICY IF EXISTS`), puis
  `DROP FUNCTION IF EXISTS public.rls_practice_sees_org(text);`. Aucune donnée
  touchée.

## Notes

- `set_config(key, value, TRUE)` = portée transaction → compatible avec un
  pooler en mode transaction (PgBouncer). Un `SET` de session ne le serait pas.
- **Sur Supabase (hébergement intérimaire, ADR-120)** : le pooler Supavisor en
  mode transaction (port 6543) est compatible pour la même raison — c'est
  `DATABASE_URL` (runtime). Les migrations passent par `DIRECT_URL` (port 5432),
  hors pooler. Le rôle `postgres` de Supabase a des privilèges élevés implicites
  (il contourne RLS comme le propriétaire) : l'étape 2 ci-dessus (`CREATE ROLE
  facture_app` non-propriétaire, sans BYPASSRLS) reste indispensable pour activer
  réellement le RLS — la créer via l'éditeur SQL Supabase, puis basculer
  `DATABASE_URL` des deux apps (`fly secrets set`) sur `facture_app`, la connexion
  passant toujours par le pooler. Les rôles Supabase `anon` / `authenticated` /
  `service_role` / `authenticator` ne sont **pas** utilisés (ni PostgREST, ni
  GoTrue — l'IAM est dans trust-api) : aucune policy `auth.uid()`, uniquement les
  policies `org_isolation` par GUC de session posées par la migration.
- Chaque opération scopée = une transaction. Surcoût mesurable ; à surveiller sur
  les endpoints à fort volume (`GET /invoices`). Alternative si besoin :
  regrouper plusieurs lectures dans un `$transaction` interactif unique.
- `merkle_anchor_batch` (E1) est **cross-organisation** par conception (une
  tranche couvre N orgs) → **jamais** de politique RLS dessus, comme
  `payment_webhook`. Le job de scellement lit les factures de toutes les orgs.
- `payment_webhook`, `merkle_anchor_batch`, `data_rights_request` (cross-org par
  conception) ne sont **pas** couvertes. `professional_practice` / `practice_member`
  non plus (jamais exposées cross-tenant). Le scope practice (`app.current_practice_id`)
  est en place depuis `20260905120000_rls_practice_scope` — ce qui était « ADR-111
  phase 2 ».
- **Interaction avec la rétention (J3)** : `RetentionService` purge `ussd_session`,
  `client_portal_otp`, `pending_member_invite` via le `PrismaClient` NON scopé →
  aucun GUC posé → l'échappement dormant
  `(app.current_org_id IS NULL AND app.current_practice_id IS NULL)` fire → la
  purge s'exécute cross-org (voulu, job système). Inchangé par
  `20260905120000` (qui ne fait qu'ajouter `AND app.current_practice_id IS NULL`
  à un échappement déjà pris). **Si une phase ultérieure retire cet échappement**,
  la purge serait silencieusement neutralisée (`deleteMany` count 0, aucune
  erreur) : prévoir alors un rôle/bypass dédié, et surveiller
  `trust_api_retention_rows_deleted_total`.
- `bank_transaction` (rapprochement bancaire, ADR-117) porte `organization_id`
  → politique `org_isolation` **standard** posée par la migration
  `20260831130000_bank_transaction` (dormante, même forme `IS NULL OR …` que les
  autres tables directes). `BankReconciliationService` utilise le `PrismaClient`
  NON scopé mais filtre **toujours** explicitement sur `organizationId` (résolu
  du path param `:id` par le `RolesGuard`) : la bascule phase 2 sur un rôle
  applicatif ne change rien à son comportement. Table append-partielle : colonnes
  d'identité immuables + `DELETE` interdit (trigger
  `bank_transaction_identity_immutable`), colonnes d'état (`state`, `matched_*`,
  `resolved_*`) mutées par `confirm` / `ignore` → l'étape 5
  (`REVOKE UPDATE, DELETE, TRUNCATE … FROM facture_app`) devra **conserver le
  `UPDATE`** sur `bank_transaction` (ou passer par un rôle dédié), comme pour
  `customer`.
- `data_rights_request` (J2) est **cross-organisation** : le chemin ops plateforme
  (`POST /internal/data-rights/*`) écrit des lignes `organization_id IS NULL`
  (demande transverse) → **jamais** de politique RLS dessus, comme
  `merkle_anchor_batch` / `payment_webhook`. La table est append-only (trigger
  `data_rights_request_append_only`, pattern J1). L'anonymisation `Customer` de
  J2, elle, écrit sur `customer` (déjà scopé org) via le `PrismaClient` NON scopé
  du service `DataRightsService` — même posture que la rétention ci-dessus, et
  l'étape 5 (`REVOKE UPDATE, DELETE, TRUNCATE … FROM facture_app`) devra **exclure
  `customer`** de son `UPDATE` (l'anonymisation est un `UPDATE` légitime), ou
  passer par un rôle dédié.
