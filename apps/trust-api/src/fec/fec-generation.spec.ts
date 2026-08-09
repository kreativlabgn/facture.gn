import { describe, expect, it } from "vitest";
import { generateFecEntries, type FecInvoiceInput } from "./fec-generation";

function invoiceWithoutTva(overrides: Partial<FecInvoiceInput> = {}): FecInvoiceInput {
  return {
    number: "FG-2026-000001",
    issuedAt: new Date("2026-08-01T00:00:00.000Z"),
    totalHt: 2_000_000n,
    totalTva: 0n,
    totalTtc: 2_000_000n,
    payments: [],
    ...overrides,
  };
}

describe("FEC — génération d'écritures comptables (F9, ADR-062)", () => {
  it("une facture sans TVA génère une écriture de vente à 2 lignes (débit 411, crédit 707) — aucune ligne 443", () => {
    const lines = generateFecEntries([invoiceWithoutTva()]);

    expect(lines).toHaveLength(2);
    expect(lines[0].split("\t")[4]).toBe("411"); // CompteNum
    expect(lines[0].split("\t")[11]).toBe("20000.00"); // Debit
    expect(lines[1].split("\t")[4]).toBe("707");
    expect(lines[1].split("\t")[12]).toBe("20000.00"); // Credit
    expect(lines.some((l) => l.includes("443"))).toBe(false);
  });

  it("une facture avec TVA génère 3 lignes (débit 411, crédit 707, crédit 443)", () => {
    const lines = generateFecEntries([
      invoiceWithoutTva({ totalHt: 1_700_000n, totalTva: 300_000n, totalTtc: 2_000_000n }),
    ]);

    expect(lines).toHaveLength(3);
    expect(lines[0].split("\t")[4]).toBe("411");
    expect(lines[0].split("\t")[11]).toBe("20000.00");
    expect(lines[1].split("\t")[4]).toBe("707");
    expect(lines[1].split("\t")[12]).toBe("17000.00");
    expect(lines[2].split("\t")[4]).toBe("443");
    expect(lines[2].split("\t")[12]).toBe("3000.00");
  });

  it("2 paiements partiels (cash puis bank_transfer) génèrent 2 écritures de règlement distinctes (ADR-062)", () => {
    const lines = generateFecEntries([
      invoiceWithoutTva({
        payments: [
          {
            amount: 1_000_000n,
            method: "cash",
            status: "completed",
            depositType: null,
            collectedAt: new Date("2026-08-02T00:00:00.000Z"),
          },
          {
            amount: 1_000_000n,
            method: "bank_transfer",
            status: "completed",
            depositType: null,
            collectedAt: new Date("2026-08-03T00:00:00.000Z"),
          },
        ],
      }),
    ]);

    // 2 lignes vente + 2 écritures de règlement (2 lignes chacune) = 6
    expect(lines).toHaveLength(6);
    const compteNums = lines.map((l) => l.split("\t")[4]);
    expect(compteNums).toContain("571"); // caisse (cash)
    expect(compteNums).toContain("521"); // banque (bank_transfer)
  });

  it("un paiement depositType arrhes n'est jamais inclus dans les écritures de règlement", () => {
    const lines = generateFecEntries([
      invoiceWithoutTva({
        payments: [
          {
            amount: 500_000n,
            method: "cash",
            status: "completed",
            depositType: "arrhes",
            collectedAt: new Date("2026-08-02T00:00:00.000Z"),
          },
        ],
      }),
    ]);

    expect(lines).toHaveLength(2); // seulement l'écriture de vente
  });

  it("un paiement status !== completed (pending/failed) n'est jamais inclus", () => {
    const lines = generateFecEntries([
      invoiceWithoutTva({
        payments: [
          {
            amount: 500_000n,
            method: "cash",
            status: "pending",
            depositType: null,
            collectedAt: new Date("2026-08-02T00:00:00.000Z"),
          },
          {
            amount: 500_000n,
            method: "cash",
            status: "failed",
            depositType: null,
            collectedAt: new Date("2026-08-02T00:00:00.000Z"),
          },
        ],
      }),
    ]);

    expect(lines).toHaveLength(2); // seulement l'écriture de vente
  });

  it("EcritureNum est séquentiel sur l'ensemble de l'export, jamais réinitialisé par facture", () => {
    const lines = generateFecEntries([invoiceWithoutTva(), invoiceWithoutTva({ number: "FG-2026-000002" })]);

    const ecritureNums = lines.map((l) => l.split("\t")[2]);
    expect(ecritureNums).toEqual(["1", "2", "3", "4"]);
  });
});
