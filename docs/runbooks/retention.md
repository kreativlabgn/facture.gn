# Runbook — Rétention des tables opérationnelles éphémères (J3)

Lot J3 (Vague 3). Purge périodique des lignes mortes des tables techniques à
durée de vie courte. **Hygiène d'exploitation**, pas une politique de rétention
au sens L/2016/037/AN — les droits des personnes (export, effacement sur demande)
relèvent de J2.

## Ce qui est purgé

Job `retention-daily` (file BullMQ `retention`, trust-api), une fois par jour.
`RetentionService.runOnce()` traite chaque table dans un `try/catch` indépendant :
une table en échec n'empêche pas les autres, le job ne rejette jamais.

| Table | Règle de suppression | Délai de grâce (constante) |
|---|---|---|
| `ussd_session` | `expiresAt < now − grâce` | 24 h (`USSD_SESSION_GRACE_MS`) |
| `client_portal_otp` | `expiresAt < now − grâce` | 7 j (`CLIENT_PORTAL_OTP_GRACE_MS`) |
| `revoked_token` | `expiresAt < now − grâce` | 24 h (`REVOKED_TOKEN_GRACE_MS`) |
| `pending_member_invite` | **non acceptée** (`acceptedAt IS NULL`) **et** `expiresAt < now − grâce` | 30 j (`PENDING_MEMBER_INVITE_GRACE_MS`) |
| `assisted_session` | **révoquée uniquement** (`revokedAt IS NOT NULL`) **et** `revokedAt < now − grâce` | 90 j (`ASSISTED_SESSION_REVOKED_GRACE_MS`) |

Constantes : `apps/trust-api/src/retention/retention.constants.ts` (ajustables en
un seul point ; aucune spec ADR/Backlog ne fixe ces durées).

### Jamais purgé
- **`invoice_event`** — WORM (ADR-015), garde append-only (J1). Hors périmètre par conception.
- Une `pending_member_invite` **acceptée** — `resolvedUserId` est une trace utile.
- Une `assisted_session` seulement **expirée** (non révoquée) — `consentRecordedAt`
  est une preuve de consentement (L/2016/037) pour des factures conservées 10 ans.
  Seule une révocation explicite (fin de mission) + 90 j déclenche la purge.

### Non couvert (fast-follow)
`payment_webhook`, `payment_provider_attempt` (money-api — l'infra BullMQ y est
déjà, Lot E). À traiter dans un lot séparé si le volume le justifie.

## Activation / désactivation

- `RETENTION_ENABLED=false` (défaut CI + `.env.example`) : la brique BullMQ est
  chargée, le job n'est **pas** armé.
- Toute autre valeur (ou absence) : `onModuleInit` arme le `upsertJobScheduler`
  (`retention-daily`, `every: 24 h`). Un échec d'armement (Redis KO) est loggé en
  `error` et **ne bloque pas le démarrage** de trust-api.
- Prérequis : `REDIS_URL` joignable. Connexion `lazyConnect` — trust-api démarre
  même si Redis est absent (le job ne tournera simplement pas).

## Déclenchement manuel

Aucun endpoint HTTP (comme le worker de réconciliation money-api). Pour forcer un
passage hors planning, enfiler un job dans la file `retention` via `redis-cli` ou
un petit script BullMQ (`queue.add("run", {})`), ou redémarrer l'instance avec
`RETENTION_ENABLED` actif.

## Observabilité

- Compteur Prometheus `trust_api_retention_rows_deleted_total{table}` — cumul des
  lignes supprimées par table. Un plateau prolongé à 0 sur `ussd_session` peut
  signaler un job qui ne tourne plus.
- Log structuré `pino` à chaque passage : `Purge de rétention : {"deletedByTable":…,"errored":…}`.
- Alerter si `errored` est non vide plusieurs passages de suite.

## Rollback

`RETENTION_ENABLED=false` + redémarrage → le job cesse d'être réarmé. Le
`upsertJobScheduler` existant survit dans Redis ; le supprimer avec
`queue.removeJobScheduler("retention-daily")` si besoin d'un arrêt net.
