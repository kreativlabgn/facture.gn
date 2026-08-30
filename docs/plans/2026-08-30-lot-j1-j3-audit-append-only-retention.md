# Plan : Lot J1 + J3 — `invoice_event` append-only + jobs de rétention (Vague 3)

## Contexte projet
- **Modules** : Trust Context (`invoice_event`, tables éphémères) + Platform Context (planification, audit).
- **Persona affecté** : aucun impact observable côté utilisateur final. Interne : `auditor` (fiabilité du journal), ops (volumétrie).
- **Données sensibles manipulées** : OTP (`client_portal_otp`), tokens révoqués (`revoked_token`), sessions USSD authentifiées par PIN (`ussd_session`), preuve de consentement (`assisted_session`). → `dev-security-reviewer` obligatoire. Aucune clé crypto, aucun montant.
- **Impact réglementaire** : ADR-015 (event sourcing append-only pour `invoice_event`), ADR-013 (WORM 10 ans — hors scope, concerne MinIO). Loi L/2016/037/AN : la purge de données opérationnelles expirées est *alignée* avec la minimisation, mais une **politique de rétention formelle par finalité** relève de J2 (droits des personnes), hors de ce lot.

## Clarifications
- **Q : Mécanisme du append-only J1 ?** → R : **Les deux.** (1) Trigger plpgsql actif immédiatement `BEFORE UPDATE OR DELETE` qui `RAISE EXCEPTION` — protège même contre le rôle propriétaire / un superuser par erreur ; (2) ligne `REVOKE UPDATE, DELETE ON invoice_event FROM facture_app` ajoutée à `docs/runbooks/rls-rollout.md` pour la défense en profondeur quand le rôle non-propriétaire existera.
- **Q : Infra de planification dans trust-api (qui n'en a aucune) ?** → R : **BullMQ + Redis**, copie du pattern Lot E de money-api (`QueueModule` global + module métier avec `upsertJobScheduler`, non-bloquant au boot, flag d'activation, CI désactivé).
- **Q : Périmètre et TTL de purge ?** → R : **5 tables trust-api** (`ussd_session`, `client_portal_otp`, `revoked_token`, `assisted_session`, `pending_member_invite`) + constantes de délai de grâce ajustables en un point. money-api (`payment_webhook`, `payment_provider_attempt`) = fast-follow séparé.
- **Q (découvert en planning) : `assisted_session` porte `consentRecordedAt` — preuve de consentement L/2016/037 pour des factures qui vivent 10 ans. La purger à 90 j + grâce détruirait cette preuve.** → R retenue par défaut (à confirmer en revue domaine) : ne purger `assisted_session` **que** sur `revokedAt` ancien (mission explicitement terminée) ; **ne jamais** purger une ligne seulement expirée mais non révoquée. `invoice_event` conserve de toute façon l'acteur de chaque émission.

## Problème (3 lignes)
`invoice_event` est la « source de vérité audit » (ADR-015, DAT §4) mais rien en base n'empêche un `UPDATE`/`DELETE` — un bug, une migration ou un accès compromis peut réécrire l'historique sans trace. En parallèle, cinq tables éphémères (sessions USSD, OTP, tokens révoqués, sessions assistées, invitations) accumulent des lignes mortes indéfiniment — dette explicitement notée dans le code (`ussd-session.service.ts:393`, `RevokedToken` schéma l.308, `AssistedSession` l.623).

## Solution retenue (5 lignes)
**J1** — Migration Prisma manuelle : fonction plpgsql `reject_invoice_event_mutation()` + trigger `invoice_event_append_only BEFORE UPDATE OR DELETE FOR EACH ROW`. `TRUNCATE` reste permis (pas de trigger de niveau instruction) → reset CI/tests intact. Ligne `REVOKE` documentée dans le runbook RLS.
**J3** — `apps/trust-api/src/queue/` (copie de money-api) + `apps/trust-api/src/retention/` : `RetentionService.runOnce(now)` **pur** exécute un `deleteMany` idempotent par table avec `try/catch` par table (une table en échec ne bloque pas les autres, cf. `ReconciliationService`), retourne un résumé `{ table: nombre }`. `RetentionModule.onModuleInit` arme un `upsertJobScheduler` quotidien, non-bloquant si Redis absent, désactivé par `RETENTION_ENABLED=false`. Compteur Prometheus `trust_api_retention_rows_deleted_total{table}` + log structuré.

## Alternatives écartées
- **J1 — `REVOKE` seul (dormant, cohérent Lot I/RLS)** : écarté comme mécanisme unique — ne protège de rien tant que l'app tourne en propriétaire (cas actuel, `facture_app` n'existe pas encore). Conservé en complément (runbook).
- **J1 — colonne `deleted_at` / soft-delete applicatif** : ne répond pas au problème (le code pourrait toujours réécrire `type`/`amount`/`metadata`) ; ADR-015 veut l'immuabilité physique.
- **J3 — `@nestjs/schedule` (cron in-process)** : plus léger, zéro Redis, mais s'exécute dans chaque replica (N purges concurrentes) et introduit un 2ᵉ mécanisme de planification dans le monorepo alors que BullMQ est le choix stack (DAT) déjà en place (Lot E).
- **J3 — `pg_cron`** : nécessite une extension Postgres non présente dans la stack ni gérable depuis le code applicatif.
- **J3 — endpoint HTTP de déclenchement manuel** : écarté (YAGNI) — `ReconciliationModule` n'en a pas non plus ; réarmable par redémarrage, déclenchable par script ops.

## Découpage en tâches bite-sized

### Groupe 1 — J1 : `invoice_event` append-only (livrable seul)
- [ ] Tâche 1.1 : créer `packages/db/prisma/migrations/20260830120000_invoice_event_append_only/migration.sql` — `CREATE FUNCTION reject_invoice_event_mutation()` (plpgsql, `RAISE EXCEPTION` avec `ERRCODE = 'restrict_violation'`, message citant ADR-015 et `TG_OP`) + `CREATE TRIGGER invoice_event_append_only BEFORE UPDATE OR DELETE ON "invoice_event" FOR EACH ROW EXECUTE FUNCTION reject_invoice_event_mutation()`. En-tête de commentaire expliquant : écart assumé au « SQL plat » de Lot I (une garde append-only ne se fait pas sans fonction), `TRUNCATE` volontairement non couvert (reset CI), pas de politique `INSERT`/`SELECT`.
- [ ] Tâche 1.2 : `apps/trust-api/src/invoices/invoice-event-append-only.integration.spec.ts` — gated (`DATABASE_URL` + `if (!RUN) return` dans `beforeAll`/`afterAll`, même pattern que `rls.integration.spec.ts`). Insère org + invoice + 1 `invoice_event` ; assert `UPDATE` rejeté (code `restrict_violation` ou message), `DELETE` rejeté, `INSERT` d'un 2ᵉ event OK. Cleanup via `TRUNCATE "invoice_event", "invoice", "organization" RESTART IDENTITY CASCADE` (le trigger ne bloque pas `TRUNCATE`).
- [ ] Tâche 1.3 : ajouter à `docs/runbooks/rls-rollout.md` une sous-section « Étape 5 — durcir `invoice_event` » : `REVOKE UPDATE, DELETE ON "invoice_event" FROM facture_app;` (à exécuter avec le `FORCE ROW LEVEL SECURITY`), en notant que le trigger couvre déjà le cas propriétaire.
- [ ] Tâche 1.4 : vérifier que `rls.integration.spec.ts` et `invoice-numbering.service.integration.spec.ts` restent verts (aucun ne touche `invoice_event` — confirmé en planning ; re-vérifier après migration).

### Groupe 2 — J3 : brique BullMQ trust-api (livrable seul, inerte)
- [ ] Tâche 2.1 : `apps/trust-api/package.json` — ajouter `@nestjs/bullmq` (^12), `bullmq` (^6), `ioredis` (^6). `@opentelemetry/instrumentation-ioredis` **déjà présent** (Lot H). `pnpm install`, vérifier lockfile.
- [ ] Tâche 2.2 : `apps/trust-api/src/queue/queue.config.ts` + `queue.config.spec.ts` — copie littérale de money-api (`buildRedisConnection` : `url` depuis `REDIS_URL` défaut `redis://localhost:6379`, `maxRetriesPerRequest: null`, `lazyConnect: true`) + ses 3 tests.
- [ ] Tâche 2.3 : `apps/trust-api/src/queue/queue.module.ts` — `@Global` `QueueModule` avec `BullModule.forRoot({ connection: buildRedisConnection() })`, `exports: [BullModule]` (copie money-api).
- [ ] Tâche 2.4 : `apps/trust-api/src/app.module.ts` — importer `QueueModule` (après `PrismaModule`, avant les modules métier).
- [ ] Tâche 2.5 : vérifier `apps/trust-api/src/app.module.spec.ts` (smoke DI) vert avec `QueueModule` (lazyConnect → aucune connexion Redis à l'instanciation, comme money-api).

### Groupe 3 — J3 : purge de rétention (livrable seul)
- [ ] Tâche 3.1 : `apps/trust-api/src/retention/retention.constants.ts` — `RETENTION_INTERVAL_MS = 24h` ; délais de grâce (après `expiresAt`) : `USSD_SESSION_GRACE_MS = 24h`, `CLIENT_PORTAL_OTP_GRACE_MS = 7j`, `REVOKED_TOKEN_GRACE_MS = 24h`, `PENDING_MEMBER_INVITE_GRACE_MS = 30j`, `ASSISTED_SESSION_REVOKED_GRACE_MS = 90j`. En-tête : aucune spec ADR/Backlog ne fixe ces durées (comme `ASSISTED_SESSION_TTL_MS`/`PENDING_MEMBER_INVITE_TTL_MS`) — ajustables ici uniquement.
- [ ] Tâche 3.2 : `apps/trust-api/src/retention/retention.service.ts` — `RetentionService` injecte `PRISMA_CLIENT`. `async runOnce(now = new Date()): Promise<RetentionSummary>` : pour chacune des 5 tables, `try { count += (await deleteMany({ where })).count } catch (e) { log.error ; errored.push(table) }`. `where` par table :
  - `ussdSession` : `{ expiresAt: { lt: now - USSD_SESSION_GRACE_MS } }`
  - `clientPortalOtp` : `{ OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: now } }], expiresAt: { lt: now - CLIENT_PORTAL_OTP_GRACE_MS } }` → simplifier : `{ expiresAt: { lt: now - CLIENT_PORTAL_OTP_GRACE_MS } }` (un OTP consommé a de toute façon un `expiresAt` proche).
  - `revokedToken` : `{ expiresAt: { lt: now - REVOKED_TOKEN_GRACE_MS } }`
  - `pendingMemberInvite` : `{ acceptedAt: null, expiresAt: { lt: now - PENDING_MEMBER_INVITE_GRACE_MS } }` (jamais purger une invitation acceptée : `resolvedUserId` est une trace utile).
  - `assistedSession` : `{ revokedAt: { not: null, lt: now - ASSISTED_SESSION_REVOKED_GRACE_MS } }` — **jamais** sur `expiresAt` seul (preuve de consentement).
  Retourne `{ deletedByTable: Record<string, number>, errored: string[] }`.
- [ ] Tâche 3.3 : `apps/trust-api/src/retention/retention.metrics.ts` — compteur prom-client `trust_api_retention_rows_deleted_total` labels `{table}` (registre préfixé `trust_api_`, cf. `HttpMetricsInterceptor`). Incrémenté par `RetentionService` après chaque table.
- [ ] Tâche 3.4 : `apps/trust-api/src/retention/retention.processor.ts` — `@Processor(RETENTION_QUEUE)` `extends WorkerHost`, `process()` → `runOnce()` + `logger.log(JSON.stringify(summary))` (copie mince, cf. `ReconciliationProcessor`).
- [ ] Tâche 3.5 : `apps/trust-api/src/retention/retention.module.ts` — `BullModule.registerQueue({ name: RETENTION_QUEUE })`, providers `[RetentionService, RetentionProcessor]`, `onModuleInit` : si `RETENTION_ENABLED === "false"` → `logger.warn` + return ; sinon `try { await queue.upsertJobScheduler("retention-daily", { every: RETENTION_INTERVAL_MS }, { name: "run" }) } catch { logger.error(...) }` (démarrage jamais bloqué).
- [ ] Tâche 3.6 : `apps/trust-api/src/app.module.ts` — importer `RetentionModule`.
- [ ] Tâche 3.7 : `.github/workflows/ci.yml` — job `build`, bloc `env:` : ajouter `RETENTION_ENABLED: "false"` (le service `redis` et `REDIS_URL` existent déjà, ajoutés au Lot E).
- [ ] Tâche 3.8 : `docker-compose.yml` — service `trust-api` (profil `full`) : ajouter `REDIS_URL` et `RETENTION_ENABLED` à `environment` si absent. `.env.example` : documenter `REDIS_URL`, `RETENTION_ENABLED`.
- [ ] Tâche 3.9 : `apps/trust-api/src/app.module.spec.ts` — vérifier vert avec `RetentionModule` (env de test : `RETENTION_ENABLED=false`, `redisConnection` lazy).
- [ ] Tâche 3.10 : `docs/runbooks/retention.md` — tables purgées, délais de grâce et leur justification (dont le cas `assisted_session`), `RETENTION_ENABLED`, déclenchement manuel via `redis-cli`/script, où ajuster les constantes.

### Groupe 4 — clôture
- [ ] Tâche 4.1 : `pnpm --filter @facture-gn/db db:generate && build` (aucun changement de schéma Prisma → client inchangé, mais la migration doit être visible de `db:migrate:deploy`).
- [ ] Tâche 4.2 : revalidation complète — `pnpm exec tsc` (trust-api), `pnpm exec eslint`, `pnpm exec vitest` (trust-api + money-api + db), `audit-ci`.
- [ ] Tâche 4.3 : ADR ? — proposer à l'utilisateur un **ADR-113 (rétention des données opérationnelles éphémères)** dans `V/` : catalogue des tables, principe (purge = minimisation, jamais `invoice_event`), délais par défaut non normatifs. Rédigé seulement après validation.

## Tests à écrire AVANT le code

### J1
- [ ] `invoice-event-append-only.integration.spec.ts` (gated real Postgres) : `UPDATE invoice_event` → rejet ; `DELETE FROM invoice_event` → rejet ; `INSERT` → OK ; `TRUNCATE invoice_event` → OK (cleanup).
- [ ] Non-régression : `rls.integration.spec.ts` + `invoice-numbering.service.integration.spec.ts` toujours verts.

### J3 — `retention.service.spec.ts` (Prisma mocké, pur)
- [ ] `runOnce(now)` appelle `deleteMany` sur les 5 tables avec le `where` attendu (snapshot par table du `where` calculé).
- [ ] Grâce : une ligne `expiresAt = now` n'est PAS purgée ; `expiresAt = now - grace - 1s` l'est.
- [ ] `assisted_session` : ligne expirée mais `revokedAt = null` → NON purgée ; `revokedAt = now - 91j` → purgée.
- [ ] `pending_member_invite` : `acceptedAt != null` → jamais purgée, même très ancienne.
- [ ] Résilience : `deleteMany` de la 2ᵉ table jette → les tables 3-4-5 sont quand même traitées, `errored` contient la table 2, `runOnce` ne rejette pas.
- [ ] Le résumé retourné agrège correctement les compteurs ; le compteur Prometheus est incrémenté par table.

### J3 — `retention.module.spec.ts`
- [ ] `RETENTION_ENABLED=false` → `upsertJobScheduler` jamais appelé.
- [ ] `upsertJobScheduler` qui rejette (Redis KO) → `onModuleInit` ne rejette pas (démarrage préservé).

### Smoke DI
- [ ] `app.module.spec.ts` (trust-api) vert avec `QueueModule` + `RetentionModule`.

## Critères de done
- Aucun `[NEEDS CLARIFICATION]` restant (le cas `assisted_session` est tranché par défaut + à valider en revue domaine).
- Tous les tests verts (hors `invoice-numbering.service.integration.spec.ts` en environnement sans Postgres — échec pré-existant connu).
- `tsc` + `eslint` + `audit-ci` clean.
- Aucune donnée sensible loggée (le résumé de purge ne contient que des noms de tables et des compteurs — jamais un `msisdn`, un `jti`, un `codeHash`).
- Aucun secret en dur (`REDIS_URL` via env).
- `dev-code-reviewer` OK.
- `dev-security-reviewer` OK (OTP / tokens / sessions PIN / consentement).
- `dev-domain-model-reviewer` OK (revue spécifique du périmètre de purge `assisted_session` / `pending_member_invite`).
- `dev-resilience-reviewer` OK (try/catch par table, `onModuleInit` non-bloquant).

## Risques identifiés & mitigations
- **R1 — le trigger casse un test/migration qui `DELETE`/`UPDATE` `invoice_event`.** → Mitigation : grep confirmé (0 mutation en code applicatif), les 2 specs d'intégration ne touchent pas la table ; cleanup de test via `TRUNCATE` (non couvert par le trigger). Tâche 1.4 re-vérifie.
- **R2 — purge d'une ligne encore utile** (OTP valide non consommé, session USSD en cours). → Mitigation : borne `expiresAt < now - grace`, jamais sur la seule présence ; grâce ≥ 24 h partout ; `assisted_session` uniquement sur `revokedAt`.
- **R3 — perte de preuve de consentement `assisted_session`** (L/2016/037, factures conservées 10 ans). → Mitigation : ne jamais purger sur `expiresAt` seul ; seulement `revokedAt` + 90 j. À confirmer en revue domaine ; option de sortie = retirer `assisted_session` du périmètre.
- **R4 — Redis devient une dépendance de démarrage de trust-api.** → Mitigation : `lazyConnect: true` (smoke DI OK sans Redis), `onModuleInit` en `try/catch` (comme Lot E), CI `RETENTION_ENABLED=false`.
- **R5 — la migration `$$` plpgsql casse un exécuteur naïf** (le commentaire de la migration RLS Lot I redoutait un split sur `;`). → Mitigation : `prisma migrate deploy` passe le fichier entier ; documenter dans l'en-tête que cette migration exige un exécuteur qui gère les `$$` (ce qui est le cas de Prisma).
- **R6 — plusieurs replicas trust-api arment le même scheduler.** → Mitigation : `upsertJobScheduler` avec un `jobId` stable (`retention-daily`) → BullMQ dédoublonne (identique au pattern Lot E).
- **R7 — RLS (dormante) + purge cross-org.** → La purge tourne sans `app.current_org_id` ; les politiques RLS Lot I sont `current_setting(...) IS NULL OR ...` → laissent passer. Job système cross-org fonctionnel par conception, même après `FORCE`. À noter dans le runbook.

## Séquence de build
1. Groupe 1 (J1) — indépendant, livrable et mergé seul.
2. Groupe 2 (brique BullMQ) — inerte, livrable seul.
3. Groupe 3 (purge) — dépend du Groupe 2.
4. Groupe 4 — clôture + proposition ADR-113.
