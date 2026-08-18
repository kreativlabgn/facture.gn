import { describe, expect, it } from "vitest";
import { createProductSchema } from "./create-product.dto";

describe("createProductSchema", () => {
  it("accepte un nom non vide", () => {
    const result = createProductSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Riz 25kg",
    });
    expect(result.success).toBe(true);
  });

  it("rejette un nom vide", () => {
    const result = createProductSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejette un organizationId mal formé", () => {
    const result = createProductSchema.safeParse({ organizationId: "pas-un-uuid", name: "Riz 25kg" });
    expect(result.success).toBe(false);
  });
});
