import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { JwtAuthTokenService } from "./auth-token.service";

function generateTestKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

describe("JwtAuthTokenService", () => {
  it("émet un JWT RS256 (ADR-011) dont le payload contient uniquement l'identifiant utilisateur", async () => {
    const { privateKey, publicKey } = generateTestKeyPair();
    const service = new JwtAuthTokenService(privateKey, publicKey);

    const token = await service.sign({ sub: "user-aissatou-1" });
    const payload = await service.verify(token);

    expect(payload.sub).toBe("user-aissatou-1");
    // Le rôle ne doit jamais être mis en cache dans le token (risque de privilège
    // périmé après changement/révocation — voir plan auth-rbac, Risque 3).
    expect(payload).not.toHaveProperty("role");
  });

  it("rejette un token signé avec une autre paire de clés", async () => {
    const pairA = generateTestKeyPair();
    const pairB = generateTestKeyPair();
    const signer = new JwtAuthTokenService(pairA.privateKey, pairA.publicKey);
    const verifier = new JwtAuthTokenService(pairB.privateKey, pairB.publicKey);

    const token = await signer.sign({ sub: "user-1" });

    await expect(verifier.verify(token)).rejects.toThrow();
  });

  it("rejette un token expiré", async () => {
    const { privateKey, publicKey } = generateTestKeyPair();
    const service = new JwtAuthTokenService(privateKey, publicKey, { expiresIn: "1ms" });

    const token = await service.sign({ sub: "user-1" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(service.verify(token)).rejects.toThrow();
  });
});
