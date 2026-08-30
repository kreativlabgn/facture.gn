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

### Groupe 1 — J1 : `invoice_event` append-only (livrable seul) — ✅ LIVRÉ (commit à venir)
- [x] Tâche 1.1 : `packages/db/prisma/migrations/20260830120000_invoice_event_append_only/migration.sql` — `reject_invoice_event_mutation()` plpgsql (`RAISE EXCEPTION`, `ERRCODE = 'restrict_violation'`, message « append-only » + `TG_OP`) + trigger `invoice_event_append_only BEFORE UPDATE OR DELETE FOR EACH ROW`. En-tête : garde ACTIVE (≠ RLS dormante), écart assumé au SQL plat, `TRUNCATE` non couvert.
- [x] Tâche 1.2 : **`packages/db/src/invoice-event-append-only.integration.spec.ts`** (déplacé depuis `apps/trust-api/` — c'est une garantie DB pure, même emplacement que `rls.integration.spec.ts`, aucun besoin de l'infra de test trust-api). Gated sur `DATABASE_URL` (le trigger n'est PAS bypassé par le superuser, contrairement à la RLS → le test TOURNE en CI et valide réellement). 3 cas : `UPDATE` rejeté (`/append-only/i`), `DELETE` rejeté + ligne toujours là, `INSERT` toujours permis. Cleanup `TRUNCATE ... CASCADE`.
- [x] Tâche 1.3 : `docs/runbooks/rls-rollout.md` — nouvelle « Étape 5 — Durcir `invoice_event` » : `REVOKE UPDATE, DELETE ON "invoice_event" FROM facture_app` en complément du trigger, + rollback.
- [x] Tâche 1.4 : `rls.integration.spec.ts` + `invoice-numbering.service.integration.spec.ts` inchangés ; suites `packages/db` (4 passed, 5 skipped) et `trust-api` (1213 passed, 3 skipped) vertes. tsc + eslint `packages/db` OK.
- **Note RED/GREEN** : aucun Postgres dans l'environnement de dev (comme Lot I) → le cycle RED→GREEN du trigger est validé par la CI (`build` job, `postgres:16`, `DATABASE_URL` défini). Sans la migration, le spec échoue (`UPDATE` réussirait) ; avec, il passe. Localement : spec correctement skippé, zéro régression.
- **Revues** (`dev-code-reviewer` inline + `dev-security-reviewer` et `dev-domain-model-reviewer` en sous-agents) → **APPROUVÉ / COHÉRENT**, aucun finding bloquant. Correctifs appliqués : nettoyage de test scopé (`874d5dc`) ; en-tête de migration nuancé sur la portée réelle (bloque le DML direct, pas le DDL/`TRUNCATE` sous rôle propriétaire) ; `SET search_path = ''` + `SECURITY INVOKER` + `CREATE OR REPLACE TRIGGER` ; runbook étape 5 enrichie (`REVOKE TRUNCATE`, anti-`GRANT ALL`, `TRUNCATE CASCADE`, check `REVOKE CREATE ON SCHEMA public FROM PUBLIC`) + section « correction exceptionnelle / bris de glace » + alerte `restrict_violation`.

### Contraintes d'entrée léguées aux lots suivants (issues des revues J1)
- **J2 (droits des personnes, L/2016/037)** : le trigger rend `invoice`/`organization` définitivement indélébiles et `invoice_event.actor_id`/`metadata` non anonymisables en place. La conception J2 doit trancher explicitement : anonymisation = nouvel événement ? `DISABLE TRIGGER` supervisé (procédure du runbook) ? exclusion des colonnes du périmètre d'effacement au titre de la conservation comptable OHADA 10 ans ? — à décider AVANT de coder J2, pas à la découverte.
- **J3 (rétention)** : `invoice_event` est explicitement **hors périmètre de purge** (WORM, ADR-015). Le pattern d'isolation des tests d'intégration `packages/db` (aujourd'hui `TRUNCATE` global) est à consolider quand J3 ajoutera d'autres specs.
- **Suivi hors Vague 3** : (a) hash-chaining d'`invoice_event` (le trigger empêche l'altération/suppression mais pas l'injection d'événements forgés — `facture_app` garde INSERT sans chaînage d'intégrité type Ed25519) → proposer un ADR ; (b) validation croisée `type`↔`amount`↔`metadata` à la création (`InvoiceEventsService.append()` typé + CHECK DB) — l'enjeu monte puisque les lignes sont désormais définitives.

### Groupe 2 — J3 : brique BullMQ trust-api — ✅ LIVRÉ
- [x] 2.1 `package.json` : `@nestjs/bullmq`^12, `bullmq`^6, `ioredis`^6 ajoutés (déjà dans le store via money-api, lockfile +9 l.). `@opentelemetry/instrumentation-ioredis` déjà présent.
- [x] 2.2 `src/queue/queue.config.ts` + `.spec.ts` (3 tests verts) — `buildRedisConnection` calqué sur money-api.
- [x] 2.3 `src/queue/queue.module.ts` — `@Global QueueModule` (`BullModule.forRoot` + `exports`).
- [x] 2.4 `app.module.ts` — `QueueModule` importé après `PrismaModule`.
- [x] 2.5 smoke DI (`app.module.spec.ts`) vert avec `QueueModule` + `RetentionModule` (2267 ms, lazyConnect → aucune connexion Redis).

### Groupe 3 — J3 : purge de rétention — ✅ LIVRÉ
- [x] 3.1 `retention.constants.ts` — `RETENTION_INTERVAL_MS` 24 h + 5 délais de grâce (USSD 24 h, OTP 7 j, revoked_token 24 h, pending_invite 30 j, assisted_session **révoquée** 90 j). En-tête : aucune spec ne fixe ces durées.
- [x] 3.2 `retention.service.ts` — `runOnce(now = new Date())` pur, `try/catch` par table, retourne `{ deletedByTable, errored }`. `where` par table conforme au plan ; `clientPortalOtp` simplifié à `{ expiresAt: { lt: … } }` ; `assistedSession` sur `{ revokedAt: { not: null, lt: … } }` uniquement.
- [x] 3.3 `retention.metrics.ts` — `trust_api_retention_rows_deleted_total{table}` (`makeCounterProvider` dans `RetentionModule`), incrémenté seulement si `count > 0`.
- [x] 3.4 `retention.processor.ts` — `@Processor(RETENTION_QUEUE)` mince (log du résumé).
- [x] 3.5 `retention.module.ts` — `registerQueue` + `onModuleInit` (`RETENTION_ENABLED=false` → warn+return ; sinon `upsertJobScheduler("retention-daily", { every })` en `try/catch` non-bloquant).
- [x] 3.6 `app.module.ts` — `RetentionModule` importé.
- [x] 3.7 `.github/workflows/ci.yml` — `RETENTION_ENABLED: "false"` dans le job `build`.
- [x] 3.8 `docker-compose.yml` (service `trust-api` : `REDIS_URL` + `RETENTION_ENABLED` + `depends_on: redis`) ; `apps/trust-api/.env.example` (`REDIS_URL`, `RETENTION_ENABLED`).
- [x] 3.9 `app.module.spec.ts` — `RETENTION_ENABLED: "false"` ajouté au `TEST_ENV` ; smoke vert.
- [x] 3.10 `docs/runbooks/retention.md` — tables, délais + justifications (dont `assisted_session`), activation, déclenchement manuel, observabilité, rollback.
- **Tests** : `retention.service.spec.ts` (7), `retention.module.spec.ts` (3), `queue.config.spec.ts` (3) → verts. Suite trust-api **1226 passed / 3 skipped**, couverture 92.9/94.2/82.6/92.9 (> seuils). money-api 112, db 4, audit-ci OK. tsc + eslint clean (0 nouveau warning).

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
