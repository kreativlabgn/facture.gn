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

  describe("otpCode (Cross-Story Audit 2026-08-24, finding #2)", () => {
    it("accepte l'absence d'otpCode — requis seulement pour une réclamation de compte fantôme, vérifié par AuthService, pas par ce schéma", () => {
      const result = registerSchema.safeParse({
        name: "Aissatou Diallo",
        msisdn: "+224622334455",
        password: "MotDePasse-Solide-2026",
      });

      expect(result.success).toBe(true);
    });

    it("accepte un otpCode à 4 chiffres", () => {
      const result = registerSchema.safeParse({
        name: "Aissatou Diallo",
        msisdn: "+224622334455",
        password: "MotDePasse-Solide-2026",
        otpCode: "1234",
      });

      expect(result.success).toBe(true);
    });

    it("rejette un otpCode qui n'est pas au format 4 chiffres", () => {
      const result = registerSchema.safeParse({
        name: "Aissatou Diallo",
        msisdn: "+224622334455",
        password: "MotDePasse-Solide-2026",
        otpCode: "12a4",
      });

      expect(result.success).toBe(false);
    });
  });
});
