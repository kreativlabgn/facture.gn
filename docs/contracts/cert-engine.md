# Contrat — Cert-Engine isolé (E4, ADR-112)

Service de signature Ed25519 isolé (cible Rust, 12 000 signatures/s, DAT §1).
Ce document fige l'interface pour que l'implémentation puisse démarrer
indépendamment du reste.

## Principe : la frontière ne porte qu'un hash

`trust-api` garde toute la logique métier de certification :

1. canonicalisation **FGN-Canon-v1** (RFC 8785 JCS + clés ASCII + entiers) du
   `CertifiablePayload` (exactement 6 champs — `invoiceId`, `organizationNif`,
   `number`, `totalTtc`, `issuedAt`, `previousHash` — **jamais élargi**) ;
2. `hash = SHA-256(canonical)` ;
3. `certification_id = GN-{NIF8}-{YYYY}-{HASH6}`.

Le Cert-Engine ne reçoit **que le hash** (32 octets hex) + une référence de clé.
Il ne voit jamais la facture, les montants, le NIF, le payload. Une compromission
de `trust-api` n'expose aucune clé Ed25519 ; une compromission du Cert-Engine
n'expose aucune donnée métier.

## Custodie des clés

Le Cert-Engine est le **seul** détenteur des clés privées Ed25519 par
organisation (`OrganizationSigningKey`). Deux options d'implémentation, tranchées
à l'implémentation :

- **A — le Cert-Engine possède son propre magasin** (table répliquée ou base
  dédiée) + son propre `CERTIFICATION_MASTER_KEY` (chiffrement enveloppe,
  `envelope-encryption.ts`). `trust-api` ne stocke plus `encrypted_private_key`.
- **B — `trust-api` transmet la clé chiffrée** à chaque appel, le Cert-Engine
  détient uniquement le master key. Moins de duplication de données, mais la clé
  chiffrée transite (acceptable : inutile sans le master key).

Provisioning d'une clé (`provisionRootKey`) et révocation (`revoke`, A4/ADR-025)
deviennent des appels au Cert-Engine.

## API HTTP (v1)

Auth : **mTLS** entre `trust-api` et le Cert-Engine (réseau interne cluster,
jamais exposé). En complément, en-tête `X-Internal-Api-Key` (secret dédié,
distinct de `MONEY_API_INTERNAL_KEY`).

### `POST /v1/keys`

Provisionne une clé racine pour une organisation.

```
Request  { "organizationId": "org_abc" }
Response 201 { "keyId": "key_123", "publicKey": "<hex 64>" }
```

Idempotent sur `organizationId` (409 si déjà provisionnée).

### `POST /v1/sign`

```
Request  { "keyRef": "org_abc", "hashHex": "<sha256 hex 64>" }
Response 200 { "keyId": "key_123", "signatureHex": "<ed25519 sig hex 128>" }
         409 { "error": "key_revoked", "revokedAt": "2026-08-20T10:00:00Z" }
         404 { "error": "key_not_found" }
```

`keyRef` = `organizationId`. La garde de révocation (ADR-025, jamais rétroactive)
vit ici.

### `POST /v1/verify`

```
Request  { "keyId": "key_123", "hashHex": "…", "signatureHex": "…" }
Response 200 { "valid": true, "revokedAt": null }
```

Vérifie par `keyId` (pas `organizationId`) — l'intégrité d'une facture déjà
signée se contrôle contre la clé qui l'a signée, même révoquée depuis
(`verifyWithKey`).

### `POST /v1/keys/:organizationId/revoke`

```
Response 200 { "keyId": "key_123", "revokedAt": "2026-08-29T12:00:00Z" }
```

Idempotent (préserve l'horodatage de la 1re révocation).

### `GET /health/live` · `GET /health/ready` · `GET /metrics`

Mêmes conventions que trust-api / money-api (Lot F).

## Seam côté trust-api

Interface cible (non encore extraite — chantier E4) :

```ts
interface SignatureEngine {
  provisionKey(organizationId: string): Promise<{ keyId: string; publicKey: string }>;
  sign(organizationId: string, hashHex: string): Promise<{ keyId: string; signatureHex: string }>;
  verify(keyId: string, hashHex: string, signatureHex: string): Promise<{ valid: boolean; revokedAt: Date | null }>;
  revoke(organizationId: string): Promise<{ keyId: string; revokedAt: Date }>;
}
```

- `InProcessSignatureEngine` — comportement actuel (`envelope-encryption` +
  `@noble/curves`), défaut tant que `CERT_ENGINE_URL` est absent.
- `RemoteSignatureEngine` — client HTTP mTLS, activé par `CERT_ENGINE_URL`.

`OrganizationSigningKeyService` et `certification.service.ts` délèguent à ce seam.
La canonicalisation et le calcul du `certification_id` restent dans
`certification.service.ts`, jamais dans le Cert-Engine.

## Migration

1. Extraire `SignatureEngine` + `InProcessSignatureEngine` (aucun changement de
   comportement, sous couverture de la suite `certification.service.spec.ts` +
   `organization-signing-key.service.spec.ts`).
2. Implémenter le Cert-Engine (Rust) + `RemoteSignatureEngine`.
3. Bascule progressive : `CERT_ENGINE_URL` sur staging, rejouer la vérification
   publique (`GET /verify`) sur un échantillon de factures historiques.
4. Migrer les clés (`encrypted_private_key`) vers le magasin du Cert-Engine
   (option A) ou ajuster `RemoteSignatureEngine` pour transmettre la clé chiffrée
   (option B).
