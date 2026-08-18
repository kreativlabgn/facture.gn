import { describe, expect, it } from "vitest";
import { auditLogQuerySchema } from "./audit-log-query.dto";

describe("auditLogQuerySchema — G4, ADR-097", () => {
  it("accepte category=facture", () => {
    expect(auditLogQuerySchema.safeParse({ category: "facture" }).success).toBe(true);
  });

  it("accepte category=paiement", () => {
    expect(auditLogQuerySchema.safeParse({ category: "paiement" }).success).toBe(true);
  });

  it("accepte l'absence de category", () => {
    expect(auditLogQuerySchema.safeParse({}).success).toBe(true);
  });

  // Aucun historique de changement de rôle/permission n'existe encore dans ce
  // repo (scope réduit, voir PLAN) — "permission" doit être un 400 explicite,
  // jamais une valeur silencieusement acceptée qui masquerait ce trou.
  it("rejette category=permission — aucune donnée de ce type n'existe encore", () => {
    expect(auditLogQuerySchema.safeParse({ category: "permission" }).success).toBe(false);
  });

  it("rejette une valeur de category arbitraire", () => {
    expect(auditLogQuerySchema.safeParse({ category: "n_importe_quoi" }).success).toBe(false);
  });
});
