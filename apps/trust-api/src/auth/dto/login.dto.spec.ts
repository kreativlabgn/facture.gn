import { describe, expect, it } from "vitest";
import { loginSchema } from "./login.dto";

describe("loginSchema", () => {
  it("accepte msisdn + mot de passe", () => {
    const result = loginSchema.safeParse({
      msisdn: "+224622334455",
      password: "MotDePasse-Solide-2026",
    });

    expect(result.success).toBe(true);
  });

  it("rejette un msisdn manquant", () => {
    const result = loginSchema.safeParse({ password: "MotDePasse-Solide-2026" });

    expect(result.success).toBe(false);
  });
});
