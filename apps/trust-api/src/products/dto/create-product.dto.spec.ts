import { describe, expect, it } from "vitest";
import { createProductSchema } from "./create-product.dto";

describe("createProductSchema", () => {
  it("accepte un nom non vide avec un type valide", () => {
    const result = createProductSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Riz 25kg",
      type: "product",
    });
    expect(result.success).toBe(true);
  });

  it("rejette un nom vide", () => {
    const result = createProductSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "",
      type: "product",
    });
    expect(result.success).toBe(false);
  });

  it("rejette un organizationId mal formé", () => {
    const result = createProductSchema.safeParse({
      organizationId: "pas-un-uuid",
      name: "Riz 25kg",
      type: "product",
    });
    expect(result.success).toBe(false);
  });

  it("rejette un corps sans type", () => {
    const result = createProductSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Riz 25kg",
    });
    expect(result.success).toBe(false);
  });

  it("rejette un type hors énumération", () => {
    const result = createProductSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Riz 25kg",
      type: "consommable",
    });
    expect(result.success).toBe(false);
  });

  it("accepte type=service", () => {
    const result = createProductSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Réparation climatiseur",
      type: "service",
    });
    expect(result.success).toBe(true);
  });

  it("accepte description et salePrice quand fournis", () => {
    const result = createProductSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Riz 25kg",
      type: "product",
      description: "Riz importé, sac de 25kg",
      salePrice: 150_000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("Riz importé, sac de 25kg");
      expect(result.data.salePrice).toBe(150_000n);
    }
  });

  it("accepte l'absence de description et salePrice (catalogue sur devis)", () => {
    const result = createProductSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Réparation climatiseur",
      type: "service",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
      expect(result.data.salePrice).toBeUndefined();
    }
  });

  it("rejette une description vide après trim", () => {
    const result = createProductSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Riz 25kg",
      type: "product",
      description: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("rejette une description de plus de 500 caractères", () => {
    const result = createProductSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Riz 25kg",
      type: "product",
      description: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejette un salePrice négatif", () => {
    const result = createProductSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Riz 25kg",
      type: "product",
      salePrice: -1,
    });
    expect(result.success).toBe(false);
  });

  it("coerce une string numérique en bigint pour salePrice", () => {
    const result = createProductSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Riz 25kg",
      type: "product",
      salePrice: "150000",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.salePrice).toBe(150_000n);
    }
  });
});
