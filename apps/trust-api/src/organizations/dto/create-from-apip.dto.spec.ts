import { describe, expect, it } from "vitest";
import { createFromApipSchema } from "./create-from-apip.dto";

function validPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "Boutique Aissatou",
    regimeFiscal: "tpu",
    legalForm: "commercial",
    nif: "GN12345678",
    rccm: "RCCM-001",
    ...overrides,
  };
}

describe("createFromApipSchema — exonération association réservée aux associations (I4, ADR-057)", () => {
  it("rejette regimeFiscal=non_assujetti_association pour une organisation legalForm=commercial", () => {
    const result = createFromApipSchema.safeParse(
      validPayload({ regimeFiscal: "non_assujetti_association", legalForm: "commercial" }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["regimeFiscal"]);
    expect(result.error.issues[0]?.message).toContain("I4, ADR-057");
  });

  it("accepte regimeFiscal=non_assujetti_association pour une organisation legalForm=association", () => {
    const result = createFromApipSchema.safeParse(
      validPayload({ regimeFiscal: "non_assujetti_association", legalForm: "association" }),
    );

    expect(result.success).toBe(true);
  });

  it("accepte une association avec un régime non exonéré (activité commerciale accessoire imposable)", () => {
    const result = createFromApipSchema.safeParse(validPayload({ regimeFiscal: "normal_tva", legalForm: "association" }));

    expect(result.success).toBe(true);
  });
});
