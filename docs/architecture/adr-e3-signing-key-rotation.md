# ADR-114 (provisoire) — Rotation de la clé racine de signature par organisation

> **Provisoire** : rédigé dans `code/` car `V/Registre-ADR-facture-gn.md` est
> momentanément indisponible (migration charte en cours dans un autre contexte).
> À porter tel quel dans `V/`, Partie 28, quand `V/` est propre. Numéro **114**
> (113 réservé à l'ADR rétention, lui aussi en attente).

## Contexte

DAT §Crypto : *« Ed25519, SHA-256, **rotation 365j** »*. Le schéma stockait une
seule clé racine Ed25519 par organisation (`OrganizationSigningKey.organizationId`
`@unique`) — « rotation-safe » (`Invoice.signingKeyId` fige la clé exacte) mais
sans mécanisme actif. Seule issue en cas de suspicion : la **révocation**
(ADR-025), qui bloque toute émission sans possibilité de renouvellement.

## Décision

**Une organisation a N clés de signature dans le temps, au plus une active.**

- Nouvelle colonne `retired_at` sur `organization_signing_key`. « Actif » =
  `retired_at IS NULL AND revoked_at IS NULL`. L'invariant « une seule active »
  est encodé en base par un **index unique partiel**
  `organization_signing_key_one_active_per_org` — jamais uniquement en applicatif.
- `rotate(organizationId)` (transaction) : retire la clé active (`retired_at = now()`)
  et provisionne une nouvelle active. Course concurrente → violation d'unicité
  partielle → `409`.
- **Retrait ≠ révocation.** Une clé retirée (non révoquée) reste parfaitement
  valide pour les factures signées pendant qu'elle était active. `verifyWithKey()`
  suit `Invoice.signingKeyId` (la clé exacte), jamais « la clé courante » :
  **aucune facture déjà émise n'est re-vérifiée différemment** (principe
  non négociable — un système de confiance n'invalide jamais une certification
  déjà émise).
- `keyValidAtIssuance` (vérification publique) ne lit **que** `revoked_at`,
  jamais `retired_at` — cohérent avec ADR-025 (« révocation jamais rétroactive »).
- `certifyForOrganization()` signe avec la clé **active** ; s'il n'y en a aucune
  (toutes retirées/révoquées, ex. après une révocation), il lève `409` avec un
  message pointant `rotate`.
- `revoke(organizationId)` cible la clé **active** (cas courant : « ma clé
  courante a fuité »).

**Rotation manuelle** : `POST /organizations/:id/signing-key/rotate` (owner/admin,
self-service, même posture que la révocation). `GET /organizations/:id/signing-key`
expose l'âge de la clé active et un indicateur `rotationDue` (âge > 365 j).

## Écarté

- **Auto-rotation planifiée à 365 j** dans ce lot : une balayeuse buguée rote
  toutes les clés → indisponibilité d'émission généralisée. Reste un **fast-follow**
  dédié (pattern BullMQ opt-in comme la rétention J3, avec sa propre revue). Ce
  lot livre la rotation manuelle + l'indicateur `rotationDue`.
- **Enum `SigningKeyStatus`** : deux timestamps nullables (`retired_at`,
  `revoked_at`) + l'index partiel expriment l'invariant sans états illégaux
  représentables.
- **Révocation d'une clé retirée** (forensique) : méthode dédiée différée.
- **Certificat de délégation par canal** (ADR-026) : orthogonal — concerne les
  sous-clés par canal, pas la rotation de la racine.

## Conséquences

- `Organization.signingKey` (relation singulière) → `signingKeys[]`. Seul usage :
  le script de backfill (`where: { signingKeys: { none: {} } }`).
- Migration : `DROP INDEX organization_signing_key_organization_id_key`,
  `ADD COLUMN retired_at`, index simple + index unique partiel. Les lignes
  existantes (1/org, `retired_at` NULL) satisfont l'invariant.
- Une organisation dont la clé active a été révoquée sans rotation ensuite ne
  peut plus émettre — **comportement voulu et déjà en vigueur**, désormais avec
  un chemin de sortie (`rotate`).
- HSM cloud / Vault Transit (DAT) : la rotation `rotate()` reste la même API
  quand le stockage passera d'un chiffrement-enveloppe applicatif à un vrai HSM
  (le seam `SignatureEngine`, ADR-112, absorbe la custodie).
