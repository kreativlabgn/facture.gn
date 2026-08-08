import { describe, expect, it } from "vitest";
import { registerSchema } from "./register.dto";

describe("registerSchema", () => {
  it("accepte un enregistrement avec msisdn guinéen et mot de passe valides", () => {
    const result = registerSchema.safeParse({
      name: "Aissatou Diallo",
      msisdn: "+224622334455",
      password: "MotDePasse-Solide-2026",
    });

    expect(result.success).toBe(true);
  });

  it("rejette un msisdn hors format Guinée (+224)", () => {
    const result = registerSchema.safeParse({
      name: "Aissatou Diallo",
      msisdn: "0622334455",
      password: "MotDePasse-Solide-2026",
    });

    expect(result.success).toBe(false);
  });

  it("rejette un mot de passe trop court", () => {
    const result = registerSchema.safeParse({
      name: "Aissatou Diallo",
      msisdn: "+224622334455",
      password: "court1",
    });

    expect(result.success).toBe(false);
  });
});
