import { describe, expect, it } from "vitest";
import { computeSealHash, type FiscalSealInput } from "./fiscal-period-seal";

const base: FiscalSealInput = {
  organizationId: "org-1",
  year: 2026,
  lastInvoiceNumber: "FG-2026-000412",
  lastInvoiceHash: "abc123",
  totalHt: 91_000_000_00n,
  totalTva: 16_380_000_00n,
  totalTtc: 107_380_000_00n,
  invoiceCount: 412,
};

describe("computeSealHash — sceau d'arrêté des comptes (Lot B)", () => {
  it("est déterministe : deux appels avec le même sceau donnent le même hash", () => {
    expect(computeSealHash(base)).toBe(computeSealHash(base));
  });

  it("renvoie un SHA-256 hexadécimal (64 caractères)", () => {
    expect(computeSealHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("change si un montant change (le sceau couvre les totaux)", () => {
    expect(computeSealHash({ ...base, totalTtc: base.totalTtc + 100n })).not.toBe(computeSealHash(base));
  });

  it("change si le dernier numéro de facture change", () => {
    expect(computeSealHash({ ...base, lastInvoiceNumber: "FG-2026-000413" })).not.toBe(computeSealHash(base));
  });

  it("gère un exercice sans aucune facture (lastInvoice* null, totaux 0)", () => {
    const empty: FiscalSealInput = {
      organizationId: "org-1",
      year: 2025,
      lastInvoiceNumber: null,
      lastInvoiceHash: null,
      totalHt: 0n,
      totalTva: 0n,
      totalTtc: 0n,
      invoiceCount: 0,
    };
    expect(computeSealHash(empty)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ne perd pas de précision sur un total au-delà de Number.MAX_SAFE_INTEGER", () => {
    const huge = { ...base, totalTtc: 9_999_999_999_999_999_999n };
    expect(() => computeSealHash(huge)).not.toThrow();
    expect(computeSealHash(huge)).not.toBe(computeSealHash({ ...huge, totalTtc: huge.totalTtc - 1n }));
  });
});
