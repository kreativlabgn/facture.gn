import { describe, expect, it } from "vitest";
import { importCustomerRowSchema, importCustomersSchema } from "./import-customers.dto";
import { MAX_IMPORT_BATCH_SIZE } from "../import-customers.constants";

describe("importCustomersSchema", () => {
  it("accepte un lot avec au moins une ligne", () => {
    const result = importCustomersSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      customers: [{ name: "Boutique Sory" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejette un lot vide", () => {
    const result = importCustomersSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      customers: [],
    });
    expect(result.success).toBe(false);
  });

  it(`accepte un lot de exactement ${MAX_IMPORT_BATCH_SIZE} lignes`, () => {
    const customers = Array.from({ length: MAX_IMPORT_BATCH_SIZE }, (_, i) => ({ name: `Boutique ${i}` }));
    const result = importCustomersSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      customers,
    });
    expect(result.success).toBe(true);
  });

  it(`rejette un lot de plus de ${MAX_IMPORT_BATCH_SIZE} lignes`, () => {
    const customers = Array.from({ length: MAX_IMPORT_BATCH_SIZE + 1 }, (_, i) => ({ name: `Boutique ${i}` }));
    const result = importCustomersSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      customers,
    });
    expect(result.success).toBe(false);
  });

  it("n'échoue PAS au niveau du lot quand une ligne est structurellement invalide — validée ligne par ligne dans le service, pas ici", () => {
    const result = importCustomersSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      customers: [{ name: "Boutique Sory" }, { phone: "invalide-pas-un-nom" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("importCustomerRowSchema", () => {
  it("accepte une ligne avec uniquement le nom", () => {
    const result = importCustomerRowSchema.safeParse({ name: "Boutique Sory" });
    expect(result.success).toBe(true);
  });

  it("rejette une ligne sans nom", () => {
    const result = importCustomerRowSchema.safeParse({ phone: "+224622334455" });
    expect(result.success).toBe(false);
  });

  it("rejette un téléphone mal formé", () => {
    const result = importCustomerRowSchema.safeParse({ name: "Boutique Sory", phone: "0620000000" });
    expect(result.success).toBe(false);
  });

  it("rejette un creditLimit négatif", () => {
    const result = importCustomerRowSchema.safeParse({ name: "Boutique Sory", creditLimit: -1 });
    expect(result.success).toBe(false);
  });
});
