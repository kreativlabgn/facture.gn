import { describe, expect, it } from "vitest";
import { updateProductSchema } from "./update-product.dto";

describe("updateProductSchema", () => {
  it("accepte une mise à jour partielle (name seul)", () => {
    const result = updateProductSchema.safeParse({ name: "Riz 25kg (nouveau)" });
    expect(result.success).toBe(true);
  });

  it("accepte description=null pour effacer le champ", () => {
    const result = updateProductSchema.safeParse({ description: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  it("accepte salePrice=null pour faire redevenir un produit 'sur devis'", () => {
    const result = updateProductSchema.safeParse({ salePrice: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.salePrice).toBeNull();
    }
  });

  it("accepte isActive seul", () => {
    const result = updateProductSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
  });

  it("accepte plusieurs champs à la fois", () => {
    const result = updateProductSchema.safeParse({
      name: "Riz 25kg (nouveau)",
      description: "Description mise à jour",
      salePrice: 160_000,
      isActive: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.salePrice).toBe(160_000n);
    }
  });

  it("rejette un corps entièrement vide", () => {
    const result = updateProductSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejette un name vide après trim", () => {
    const result = updateProductSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejette une description vide après trim (distinct de null)", () => {
    const result = updateProductSchema.safeParse({ description: "   " });
    expect(result.success).toBe(false);
  });

  it("rejette une description de plus de 500 caractères", () => {
    const result = updateProductSchema.safeParse({ description: "a".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejette un salePrice négatif", () => {
    const result = updateProductSchema.safeParse({ salePrice: -1 });
    expect(result.success).toBe(false);
  });

  it("rejette un isActive non booléen", () => {
    const result = updateProductSchema.safeParse({ isActive: "oui" });
    expect(result.success).toBe(false);
  });

  it("ignore silencieusement 'type' — jamais modifiable après création", () => {
    const result = updateProductSchema.safeParse({ name: "Riz 25kg", type: "service" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("type");
      expect(Object.keys(result.data)).not.toContain("type");
    }
  });

  it("rejette un corps qui ne contiendrait QUE 'type' (aucun champ modifiable reconnu)", () => {
    const result = updateProductSchema.safeParse({ type: "service" });
    // "type" n'existe pas dans le schéma : une fois dépouillé, le corps est
    // vide — le .refine "Aucun champ à modifier" doit le rejeter.
    expect(result.success).toBe(false);
  });
});
