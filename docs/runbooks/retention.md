# Runbook — Rétention des tables opérationnelles éphémères (J3)

Lot J3 (Vague 3). Purge périodique des lignes mortes des tables techniques à
durée de vie courte. **Hygiène d'exploitation**, pas une politique de rétention
au sens L/2016/037/AN — les droits des personnes (export, effacement sur demande)
relèvent de J2.

## Ce qui est purgé

Job `retention-daily` (file BullMQ `retention`, trust-api), une fois par jour.
`RetentionService.runOnce()` traite chaque table dans un `try/catch` indépendant :
une table en échec n'empêche pas les autres, `runOnce()` ne rejette jamais. Le
processeur **fait échouer le job** (BullMQ `failed`) uniquement si **toutes** les
tables ont échoué (panne globale).

| Table | Règle de suppression | Délai de grâce (constante) |
|---|---|---|
| `ussd_session` | `expiresAt < now − grâce` | 24 h (`USSD_SESSION_GRACE_MS`) |
| `client_portal_otp` | `expiresAt < now − grâce` | 7 j (`CLIENT_PORTAL_OTP_GRACE_MS`) |
| `revoked_token` | `expiresAt < now − grâce` | 24 h (`REVOKED_TOKEN_GRACE_MS`) |
| `pending_member_invite` | **non acceptée** (`acceptedAt IS NULL`) **et** `expiresAt < now − grâce` | 30 j (`PENDING_MEMBER_INVITE_GRACE_MS`) |

Constantes : `apps/trust-api/src/retention/retention.constants.ts`. Aucune spec
ADR/Backlog ne fixe ces durées. Index dédiés :
`20260830130000_add_retention_indexes`.

### Jamais purgé
- **`invoice_event`** — WORM (ADR-015), garde append-only (J1).
- **`assisted_session`** — retirée du périmètre (revues sécurité/domaine, F-H1) :
  `consentRecordedAt` est la preuve de consentement (L/2016/037) d'un agent à
  émettre au nom d'une organisation ; les factures ainsi émises vivent 10 ans
  (OHADA) et ne portent aucune FK vers la session. La ligne est déjà conservée
  « pour la traçabilité historique » (Security Audit 2026-08-23 #8). Un
  archivage/anonymisation à échéance relève de J2.
- Une `pending_member_invite` **acceptée** — `resolvedUserId` est une trace utile.

### Non couvert (fast-follow)
- `payment_webhook`, `payment_provider_attempt` (money-api — infra BullMQ déjà
  là, Lot E).
- Suppression **par lots** (`DELETE … LIMIT n` en boucle) : le premier passage
  après un long arrêt peut supprimer un gros backlog en une transaction. Les
  index ci-dessus limitent le risque ; à revoir si le volume grimpe.
- **Journal d'audit durable des purges** (F-M3) : aujourd'hui seul un log pino +
  les compteurs Prometheus. Pour un litige (« ma donnée a-t-elle été purgée
  avant l'échéance ? ») il faudrait une table `retention_run`
  `{table, count, cutoff, jobId, ranAt}`. **Prérequis d'activation prod.**

## Activation / désactivation

**Opt-in explicite** (divergence assumée vs `RECONCILIATION_ENABLED` de money-api,
qui est non-destructif : ici c'est un `DELETE` irréversible).

- `RETENTION_ENABLED` absent, vide, ou ≠ `"true"` (insensible à la casse/espaces) :
  la brique BullMQ est chargée, le job **n'est pas** armé. Gauge
  `trust_api_retention_scheduler_armed = 0`.
- `RETENTION_ENABLED="true"` : `onModuleInit` arme `upsertJobScheduler`
  (`retention-daily`, `every: 24 h`), gauge à `1`. Un échec d'armement (Redis KO)
  est loggé en `error` (avec stack) et **ne bloque pas** le démarrage — la gauge
  reste à `0`, le job sera réarmé au prochain redémarrage.
- Connexion Redis `lazyConnect` — trust-api démarre même si Redis est absent.

### Checklist d'activation prod
1. Redis joignable en **`rediss://`** (TLS) avec un ACL dédié (pas le compte par
   défaut) — la file est partagée avec money-api, un accès Redis = contrôle de
   toutes les files BullMQ.
2. Journal d'audit durable des purges en place (F-M3 ci-dessus).
3. Alertes branchées (voir Observabilité).
4. Premier passage surveillé (backlog initial).
5. `RETENTION_ENABLED="true"`.

## Déclenchement manuel

Aucun endpoint HTTP. Pour forcer un passage : enfiler un job dans la file
`retention` (`queue.add("run", {})` via un script BullMQ, ou `redis-cli`), ou
redémarrer avec `RETENTION_ENABLED="true"`.

## Observabilité

- `trust_api_retention_rows_deleted_total{table}` — lignes supprimées (série
  créée même à 0 : un plateau prolongé signale un job qui ne tourne plus).
- `trust_api_retention_errors_total{table}` — échecs de purge. **Alerter si la
  valeur croît sur plusieurs passages.**
- `trust_api_retention_scheduler_armed` — `0` = job jamais planifié (Redis KO au
  boot, ou opt-in absent). **Alerter si `0` alors que la prod est censée l'avoir
  activé.**
- Log `pino` : `Purge de rétention : {…}` en `log` si tout va bien, `warn` +
  liste des tables si échec partiel. Job BullMQ `failed` si échec total.

## Rollback

`RETENTION_ENABLED` ≠ `"true"` + redémarrage → le job cesse d'être réarmé. Le
scheduler existant survit dans Redis ; le supprimer avec
`queue.removeJobScheduler("retention-daily")` pour un arrêt net.
