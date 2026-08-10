import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptPrivateKey, encryptPrivateKey } from "./envelope-encryption";

const MASTER_KEY = randomBytes(32);

describe("envelope-encryption — chiffrement enveloppe AES-256-GCM (A3, ADR-026)", () => {
  it("round-trip : déchiffrer une clé chiffrée retourne exactement la clé d'origine", () => {
    const rawKey = randomBytes(32);

    const encrypted = encryptPrivateKey(rawKey, MASTER_KEY);
    const decrypted = decryptPrivateKey(encrypted, MASTER_KEY);

    expect(Buffer.from(decrypted)).toEqual(Buffer.from(rawKey));
  });

  it("produit un résultat différent à chaque appel (IV aléatoire, jamais réutilisé)", () => {
    const rawKey = randomBytes(32);

    const encrypted1 = encryptPrivateKey(rawKey, MASTER_KEY);
    const encrypted2 = encryptPrivateKey(rawKey, MASTER_KEY);

    expect(encrypted1).not.toBe(encrypted2);
  });

  it("échoue à déchiffrer avec un mauvais master key — jamais un résultat silencieusement corrompu", () => {
    const rawKey = randomBytes(32);
    const encrypted = encryptPrivateKey(rawKey, MASTER_KEY);
    const wrongMasterKey = randomBytes(32);

    expect(() => decryptPrivateKey(encrypted, wrongMasterKey)).toThrow();
  });

  it("échoue à déchiffrer un ciphertext altéré — authTag GCM détecte la falsification", () => {
    const rawKey = randomBytes(32);
    const encrypted = encryptPrivateKey(rawKey, MASTER_KEY);
    const tampered = encrypted.slice(0, -2) + (encrypted.slice(-2) === "00" ? "ff" : "00");

    expect(() => decryptPrivateKey(tampered, MASTER_KEY)).toThrow();
  });
});
