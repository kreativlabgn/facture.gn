import { describe, expect, it } from "vitest";
import { Argon2PasswordService } from "./password.service";

describe("Argon2PasswordService", () => {
  const service = new Argon2PasswordService();

  it("ne stocke jamais le mot de passe en clair dans le hash produit", async () => {
    const hash = await service.hash("MotDePasse-Aissatou-2026");

    expect(hash).not.toBe("MotDePasse-Aissatou-2026");
    expect(hash).not.toContain("MotDePasse-Aissatou-2026");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("vérifie positivement le bon mot de passe", async () => {
    const hash = await service.hash("MotDePasse-Aissatou-2026");

    await expect(service.verify(hash, "MotDePasse-Aissatou-2026")).resolves.toBe(true);
  });

  it("rejette un mauvais mot de passe", async () => {
    const hash = await service.hash("MotDePasse-Aissatou-2026");

    await expect(service.verify(hash, "mauvais-mot-de-passe")).resolves.toBe(false);
  });

  it("génère un mot de passe temporaire d'au moins 16 caractères, jamais deux fois le même (B3)", () => {
    const first = service.generateTemporaryPassword();
    const second = service.generateTemporaryPassword();

    expect(first.length).toBeGreaterThanOrEqual(16);
    expect(first).not.toBe(second);
  });
});
