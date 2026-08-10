import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// A3, ADR-026 — chiffrement enveloppe AES-256-GCM : approximation MVP honnête
// d'un vrai HSM cloud (aucun SDK Vault/KMS dans ce repo, même posture déjà
// documentée pour CERTIFICATION_PRIVATE_KEY). Format de stockage : iv(12o) +
// authTag(16o) + ciphertext concaténés puis hex — un seul champ DB, pas de
// colonnes séparées. IV aléatoire à CHAQUE appel (jamais réutilisé pour une
// même clé) — condition de sécurité GCM non-négociable.
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

export function encryptPrivateKey(rawKey: Uint8Array, masterKey: Buffer): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(rawKey), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString("hex");
}

export function decryptPrivateKey(encrypted: string, masterKey: Buffer): Uint8Array {
  const buffer = Buffer.from(encrypted, "hex");
  const iv = buffer.subarray(0, IV_LENGTH_BYTES);
  const authTag = buffer.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const ciphertext = buffer.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
