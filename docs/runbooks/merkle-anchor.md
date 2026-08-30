# Runbook — Registre Merkle des factures + ancrage externe (E1, ADR-115)

## Ce qui est construit

Un registre horaire (`merkle_anchor_batch`) de racines de Merkle des hashes de
factures, **chaîné** (`previous_root`). Deux jobs BullMQ (opt-in), un seam
`AnchorSink` (`NoopAnchorSink` par défaut), et une **preuve d'inclusion** exposée
par `GET /verify/:certificationId` (champ `anchor`).

**L'ancre externe réelle n'est pas encore construite** — le registre + le seam le
sont. La garantie « vérifiable sans faire confiance à facture.gn » s'active dès
qu'un `AnchorSink` réel est branché.

## Activation

- `MERKLE_ANCHOR_ENABLED` absent / ≠ `"true"` (défaut CI + `.env.example`) : la
  brique est chargée, **aucun job n'est armé**. Gauge `trust_api_merkle_schedulers_armed = 0`.
- `MERKLE_ANCHOR_ENABLED="true"` : `onModuleInit` arme `merkle-anchor-seal-hourly`
  (`every: 1 h`) et `merkle-anchor-flush-recurring` (`every: 30 min`), gauge à `1`.
  Un échec d'armement (Redis KO) est loggé en `error` et **ne bloque pas** le
  démarrage — les jobs seront réarmés au prochain redémarrage.
- Prérequis : `REDIS_URL` joignable (`lazyConnect` — trust-api démarre sans Redis).

## Scellement (`merkle-anchor-seal`)

`sealDue()` — **un run = au plus une tranche**. Couvre toutes les factures
`hash != null`, `anchor_batch_id: null`, `issued_at < début de l'heure courante`
(les retardataires d'heures antérieures sont inclus naturellement).
`hour_start` = début de l'heure précédente (borne « as-of »). Feuilles triées par
`hash` ASC (ordre déterministe, reproductible par un tiers). `Invoice.anchor_batch_id`
assigné **une seule fois** (garde `anchor_batch_id: null` dans l'`updateMany`).
Downtime long → une grosse tranche multi-heures (assumé).

Idempotence : rejouer une heure ne double rien (`hour_start` unique + catch
`P2002` → `skipped: "already-sealed"`).

## Flush (`merkle-anchor-flush`)

Passe les tranches `pending` (les 20 plus anciennes) au `sink.anchor(root, id)` :
- `receipt` → `anchor_status = anchored` + `anchor_proof` / `anchor_ref` / `anchored_at`.
- `null` (Noop, ou sink en cours) → reste `pending`.
- exception → compteur `trust_api_merkle_flush_errors_total{sink}`, la tranche
  reste `pending`, la suivante est traitée.

**`failed` n'est JAMAIS posé automatiquement.** Le réserver à une décision
manuelle (ex. racine irrécupérable) : `UPDATE merkle_anchor_batch SET anchor_status = 'failed' WHERE id = …`
sous autorisation, avec une note. (Le trigger d'immuabilité laisse passer
`anchor_status`.)

## Brancher un `AnchorSink` réel (fast-follow, exploitation)

Créer une classe implémentant `AnchorSink` (`anchor(rootHex, batchId): Promise<AnchorReceipt | null>`,
**idempotente**), la fournir à la place de `NoopAnchorSink` dans un module
optionnel désigné par env (`MERKLE_ANCHOR_SINK`). Options :
- **Bitcoin RPC** (client maintenu) : soumettre `SHA-256(root)` dans un `OP_RETURN`,
  `null` jusqu'à N confirmations, puis `{ proof: <merkle-path-bloc>, ref: <txid>, anchoredAt: <blocktime> }`.
- **IPFS + Cloudflare** (DAT, « pinning 10 ans ») : publier `{ root, hourStart, previousRoot, signature }`,
  `{ proof: <CID+chemin>, ref: <CID>, anchoredAt: now }` — séparation de confiance
  plus faible que Bitcoin, à coupler à un support immédiat.
- OpenTimestamps si un client JS maintenu apparaît.

`audit-ci` sera réévalué à ce moment (nouvelle dépendance runtime).

## Observabilité

- `trust_api_merkle_batches_sealed_total` / `_invoices_anchored_total` — progression du scellement.
- `trust_api_merkle_flush_errors_total{sink}` — **alerter si ça croît**.
- `trust_api_merkle_pending_batches` (gauge) — **alerter si ça croît sans fin** (sink KO ou jamais branché).
- `trust_api_merkle_schedulers_armed` — `0` en prod censée activée = jobs jamais armés.

## Vérifier une preuve d'inclusion à la main

Depuis la réponse `GET /verify/:id`, champ `anchor` :
1. `leaf = SHA-256(0x00 ‖ hex_to_bytes(invoice.hash))` — doit égaler `anchor.leafHash`.
2. `current = leaf` ; pour chaque `{ siblingHex, side }` de `anchor.inclusionProof` :
   `current = side === "left" ? SHA-256(0x01 ‖ sibling ‖ current) : SHA-256(0x01 ‖ current ‖ sibling)`.
3. `current` doit égaler `anchor.merkleRoot`.
4. (quand `anchor.externalAnchor.status === "anchored"`) vérifier `anchor_proof`
   contre le support externe désigné par `anchor.externalAnchor.ref`.

## RLS

`merkle_anchor_batch` est **cross-organisation** (une tranche couvre N orgs) →
**hors politique RLS** (comme `payment_webhook`). Le job de scellement lit les
factures de toutes les organisations via le client Prisma non scopé.

## Rollback

`MERKLE_ANCHOR_ENABLED` ≠ `"true"` + redémarrage → les jobs cessent d'être
réarmés. Les schedulers existants survivent dans Redis ;
`queue.removeJobScheduler("merkle-anchor-seal-hourly" / "…-flush-recurring")`
pour un arrêt net. Les tranches déjà scellées restent (append-only, `DELETE`
interdit par le trigger).
