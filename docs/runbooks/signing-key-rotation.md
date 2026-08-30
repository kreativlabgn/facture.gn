# Runbook — Rotation de la clé racine de signature (E3, ADR-114)

## Rotation manuelle

`POST /organizations/:id/signing-key/rotate` (owner ou admin de l'organisation).
Effet : la clé active est retirée (`retired_at` posé), une nouvelle est
provisionnée et devient active. Les factures **déjà émises** restent vérifiables
telles quelles (elles référencent la clé exacte via `Invoice.signing_key_id`).
Toute facture émise **après** utilise la nouvelle clé.

`GET /organizations/:id/signing-key` → `{ active, publicKey, ageInDays,
rotationDue, revokedAt, retiredKeyCount }`. `rotationDue = true` quand
`ageInDays > 365` (cible DAT §Crypto).

## Quand roter

- `rotationDue = true` (clé > 365 j).
- Après une **révocation** (`POST .../signing-key/revoke`) : l'organisation n'a
  alors plus de clé active — `certifyForOrganization()` lève
  `409 "aucune clé de signature active — une rotation est requise"`. Roter pour
  rétablir l'émission.
- Suspicion de compromission du backup / du `CERTIFICATION_MASTER_KEY` : révoquer
  **puis** roter (la révocation marque les factures signées après compromission
  comme `keyValidAtIssuance = false` ; la rotation rétablit l'émission).

## Auto-rotation 365 j — NON activée

Différée en fast-follow (voir ADR-114). À construire sur le pattern BullMQ opt-in
de la rétention (J3) : balayeuse quotidienne rotant les clés actives dont
`ageInDays > 365`, `KEY_ROTATION_ENABLED === "true"`, non-bloquante au boot,
métrique + alerte. **Revue sécurité dédiée obligatoire** — une balayeuse buguée
rote toutes les clés d'un coup.

## Invariants (garde-fous)

- Au plus une clé active par organisation : index unique partiel
  `organization_signing_key_one_active_per_org` (`WHERE retired_at IS NULL AND
  revoked_at IS NULL`). Une course sur `rotate()` → `409 "rotation déjà en cours"`.
- `retired_at` n'affecte **jamais** la vérification d'une facture déjà signée
  (retrait ≠ révocation). Seule `revoked_at` joue sur `keyValidAtIssuance`.
- `encrypted_private_key` : jamais dans une réponse HTTP, jamais journalisé.
