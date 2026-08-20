import { describe, expect, it } from "vitest";
import { createRecurringTemplateSchema } from "./create-recurring-template.dto";

function baseDto(overrides: Record<string, any> = {}) {
  return {
    lines: [{ description: "Abonnement mensuel maintenance", quantity: 1, unitPrice: "150000" }],
    intervalDays: 30,
    ...overrides,
  };
}

describe("createRecurringTemplateSchema (I1, ADR-056)", () => {
  it("accepte un modèle minimal (lignes + intervalle, sans client ni succursale)", () => {
    const result = createRecurringTemplateSchema.safeParse(baseDto());
    expect(result.success).toBe(true);
  });

  it("accepte customerId, branchId et discountPct optionnels", () => {
    const result = createRecurringTemplateSchema.safeParse(
      baseDto({
        customerId: "8f14e45f-ceea-4b6b-9d9c-000000000001",
        branchId: "8f14e45f-ceea-4b6b-9d9c-000000000002",
        discountPct: 10,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejette un intervalle non positif", () => {
    const result = createRecurringTemplateSchema.safeParse(baseDto({ intervalDays: 0 }));
    expect(result.success).toBe(false);
  });

  it("rejette une liste de lignes vide", () => {
    const result = createRecurringTemplateSchema.safeParse(baseDto({ lines: [] }));
    expect(result.success).toBe(false);
  });

  it("rejette une demande sans intervalDays", () => {
    const result = createRecurringTemplateSchema.safeParse({ lines: baseDto().lines });
    expect(result.success).toBe(false);
  });
});
