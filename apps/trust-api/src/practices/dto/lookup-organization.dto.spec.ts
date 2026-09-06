import { describe, expect, it } from "vitest";
import { lookupOrganizationSchema } from "./lookup-organization.dto";

describe("lookupOrganizationSchema", () => {
  it("accepte un NIF guinéen à 9 chiffres", () => {
    expect(lookupOrganizationSchema.safeParse({ nif: "123456789" }).success).toBe(true);
  });

  it("retire les espaces autour de la saisie", () => {
    const result = lookupOrganizationSchema.safeParse({ nif: "  123456789  " });
    expect(result.success).toBe(true);
    expect(result.success && result.data.nif).toBe("123456789");
  });

  // Le schéma n'impose PAS « 9 chiffres » : Organization.nif est un String?
  // libre, une organisation enregistrée autrement doit rester trouvable.
  it("n'impose aucun format au-delà des bornes de longueur", () => {
    expect(lookupOrganizationSchema.safeParse({ nif: "GN-2026-0001" }).success).toBe(true);
  });

  it("rejette une saisie trop courte, trop longue, ou absente", () => {
    expect(lookupOrganizationSchema.safeParse({ nif: "12" }).success).toBe(false);
    expect(lookupOrganizationSchema.safeParse({ nif: "1".repeat(33) }).success).toBe(false);
    expect(lookupOrganizationSchema.safeParse({}).success).toBe(false);
  });

  // Une chaîne d'espaces est vide une fois trimée — elle ne doit pas passer
  // pour une recherche valide et déclencher une requête.
  it("rejette une saisie faite d'espaces", () => {
    expect(lookupOrganizationSchema.safeParse({ nif: "      " }).success).toBe(false);
  });
});
