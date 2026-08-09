import { describe, expect, it } from "vitest";
import { createPracticeSchema } from "./create-practice.dto";

describe("createPracticeSchema", () => {
  it("accepte une practice avec les 4 champs obligatoires", () => {
    const result = createPracticeSchema.safeParse({
      name: "Cabinet Mamadou & Associés",
      type: "cabinet_comptable",
      phone: "+224612345678",
    });

    expect(result.success).toBe(true);
  });

  it("rejette un type hors des 4 valeurs autorisées (ADR-078)", () => {
    const result = createPracticeSchema.safeParse({
      name: "Cabinet Mamadou & Associés",
      type: "expert_comptable_invente",
      phone: "+224612345678",
    });

    expect(result.success).toBe(false);
  });

  it("rejette un phone mal formé (pas +224 E.164)", () => {
    const result = createPracticeSchema.safeParse({
      name: "Cabinet Mamadou & Associés",
      type: "cga",
      phone: "0612345678",
    });

    expect(result.success).toBe(false);
  });

  it("accepte registrationNumber et email optionnels lorsqu'ils sont fournis", () => {
    const result = createPracticeSchema.safeParse({
      name: "CGA Kaloum",
      type: "cga",
      phone: "+224612345678",
      registrationNumber: "OCAECG-00123",
      email: "contact@cga-kaloum.gn",
    });

    expect(result.success).toBe(true);
  });

  it("rejette un email mal formé", () => {
    const result = createPracticeSchema.safeParse({
      name: "CGA Kaloum",
      type: "cga",
      phone: "+224612345678",
      email: "pas-un-email",
    });

    expect(result.success).toBe(false);
  });
});
