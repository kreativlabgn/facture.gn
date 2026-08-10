import { describe, expect, it } from "vitest";
import { organizationScopedListQuerySchema } from "./organization-scoped-list-query.dto";

describe("organizationScopedListQuerySchema", () => {
  it("accepte organizationId seul — take/skip optionnels", () => {
    const result = organizationScopedListQuerySchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result.success).toBe(true);
  });

  it("rejette un organizationId absent — jamais une liste non scopée à une organisation", () => {
    const result = organizationScopedListQuerySchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it("rejette un organizationId qui n'est pas un UUID — jamais une valeur de confiance externe", () => {
    const result = organizationScopedListQuerySchema.safeParse({ organizationId: "pas-un-uuid" });

    expect(result.success).toBe(false);
  });

  it("coerce take/skip depuis des chaînes de query string vers des nombres", () => {
    const result = organizationScopedListQuerySchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      take: "20",
      skip: "10",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.take).toBe(20);
      expect(result.data.skip).toBe(10);
    }
  });

  it("rejette un skip négatif", () => {
    const result = organizationScopedListQuerySchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      skip: "-1",
    });

    expect(result.success).toBe(false);
  });
});
