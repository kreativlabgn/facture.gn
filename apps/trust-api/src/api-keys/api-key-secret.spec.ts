import { describe, expect, it } from "vitest";
import { generateApiKeySecret } from "./api-key-secret";

describe("generateApiKeySecret", () => {
  it("préfixe fg_live_ pour l'environnement production", () => {
    const { secret } = generateApiKeySecret("production");
    expect(secret.startsWith("fg_live_")).toBe(true);
  });

  it("préfixe fg_test_ pour l'environnement sandbox", () => {
    const { secret } = generateApiKeySecret("sandbox");
    expect(secret.startsWith("fg_test_")).toBe(true);
  });

  it("génère un secret différent à chaque appel (CSPRNG)", () => {
    const first = generateApiKeySecret("production");
    const second = generateApiKeySecret("production");
    expect(first.secret).not.toBe(second.secret);
  });

  it("expose keySuffix comme les 4 derniers caractères du secret", () => {
    const { secret, keySuffix } = generateApiKeySecret("production");
    expect(secret.endsWith(keySuffix)).toBe(true);
    expect(keySuffix).toHaveLength(4);
  });
});
