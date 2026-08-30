# Runbook — Activation de Row-Level Security PostgreSQL (C2 / ADR-111)

La migration `20260829150000_enable_row_level_security` pose les politiques mais
les laisse **dormantes**. Ce runbook les active, par étapes réversibles, avec un
point de validation sur staging avant la production.

Prérequis : un environnement staging avec un PostgreSQL réel (pas SQLite, pas de
mock) et un jeu de données à ≥ 2 organisations.

## Vue d'ensemble

| État | `FORCE` ? | Rôle applicatif | `app.current_org_id` | Effet |
|---|---|---|---|---|
| Après la migration (défaut) | non | propriétaire des tables | jamais défini | aucun (double garde : bypass propriétaire + prédicat `... IS NULL OR ...`) |
| Étape 2 (rôle dédié) | non | `facture_app` (non-propriétaire) | défini par `organizationScopedClient` | RLS actif pour les requêtes scopées ; les requêtes non scopées voient tout |
| Étape 4 (FORCE) | oui | `facture_app` | défini | RLS actif y compris pour le propriétaire ; une requête non scopée ne voit **rien** |

## Étape 1 — Adopter `organizationScopedClient` dans le code

Dans chaque service qui lit/écrit des données tenant, remplacer `this.prisma` par
`organizationScopedClient(this.prisma, organizationId)` **là où l'orgId est
connu** (partout où il y a déjà un `where: { organizationId }`).

```ts
// avant
return this.prisma.invoice.findMany({ where: { organizationId, status } });
// après
return organizationScopedClient(this.prisma, organizationId).invoice.findMany({ where: { status } });
```

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

## Étape 2 — Créer le rôle applicatif non-propriétaire (staging)

```sql
CREATE ROLE facture_app LOGIN PASSWORD '<secret depuis le gestionnaire>';
GRANT CONNECT ON DATABASE facture_gn TO facture_app;
GRANT USAGE ON SCHEMA public TO facture_app;
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
- [ ] Le test d'intégration `packages/db` / `apps/trust-api` marqué
      skip-sans-`DATABASE_URL` passe (isolation réelle vérifiée).
- [ ] Aucune régression fonctionnelle sur les parcours e2e principaux.
- [ ] Les requêtes NON encore scopées (services pas encore migrés à l'étape 1)
      fonctionnent toujours (RLS non forcé → elles voient tout). Suivre leur
      migration.

## Étape 4 — `FORCE ROW LEVEL SECURITY` (après migration complète du code)

Uniquement quand **tous** les accès tenant passent par
`organizationScopedClient`. Sinon une requête non scopée ne verra plus rien.

```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'account_recovery_request','api_key','assisted_session','branch',
    'commission_bypass_case','credit_limit_change_request','customer',
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
  propriétaire + `app.current_org_id` jamais défini). Aucun `DROP POLICY`
  nécessaire.

## Notes

- `set_config(key, value, TRUE)` = portée transaction → compatible avec un
  pooler en mode transaction (PgBouncer). Un `SET` de session ne le serait pas.
- Chaque opération scopée = une transaction. Surcoût mesurable ; à surveiller sur
  les endpoints à fort volume (`GET /invoices`). Alternative si besoin :
  regrouper plusieurs lectures dans un `$transaction` interactif unique.
- `merkle_anchor_batch` (E1) est **cross-organisation** par conception (une
  tranche couvre N orgs) → **jamais** de politique RLS dessus, comme
  `payment_webhook`. Le job de scellement lit les factures de toutes les orgs.
- `payment_webhook` et les tables scoped-practice ne sont pas couvertes — voir
  ADR-111 phase 2.
- **Interaction avec la rétention (J3)** : `RetentionService` purge `ussd_session`,
  `client_portal_otp`, `pending_member_invite` via le `PrismaClient` NON scopé →
  `current_setting('app.current_org_id', true)` renvoie `NULL` → la clause
  `IS NULL OR …` des politiques laisse la purge s'exécuter cross-org (voulu, job
  système). **Si la phase 2 durcit les politiques en retirant l'échappatoire
  `IS NULL OR`**, la purge serait silencieusement neutralisée (`deleteMany`
  count 0, aucune erreur) : prévoir alors un rôle/bypass dédié pour le job de
  rétention, et surveiller `trust_api_retention_rows_deleted_total`.
