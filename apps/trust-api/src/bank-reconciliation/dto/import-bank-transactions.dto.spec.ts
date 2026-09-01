import { describe, expect, it } from "vitest";

import { importBankTransactionsSchema } from "./import-bank-transactions.dto";

const validRow = {
  valueDate: "2026-08-20",
  amountCentimes: "1500000",
  rawLabel: "VIR RECU FG-2026-000042",
};

describe("importBankTransactionsSchema", () => {
  it("accepte un lot valide et coerce valueDate en Date + amountCentimes en bigint", () => {
    const parsed = importBankTransactionsSchema.parse({ transactions: [validRow] });
    expect(parsed.transactions[0].valueDate).toBeInstanceOf(Date);
    expect(parsed.transactions[0].amountCentimes).toBe(1_500_000n);
  });

  it("rejette une valueDate invalide", () => {
    const result = importBankTransactionsSchema.safeParse({
      transactions: [{ ...validRow, valueDate: "pas-une-date" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejette un amountCentimes négatif ou nul (virements entrants seulement)", () => {
    expect(
      importBankTransactionsSchema.safeParse({ transactions: [{ ...validRow, amountCentimes: "-1000" }] })
        .success,
    ).toBe(false);
    expect(
      importBankTransactionsSchema.safeParse({ transactions: [{ ...validRow, amountCentimes: "0" }] })
        .success,
    ).toBe(false);
  });

  it("rejette un rawLabel vide", () => {
    expect(
      importBankTransactionsSchema.safeParse({ transactions: [{ ...validRow, rawLabel: "" }] }).success,
    ).toBe(false);
  });

  it("rejette un lot vide et un lot au-dessus de MAX_IMPORT_BATCH_SIZE", () => {
    expect(importBankTransactionsSchema.safeParse({ transactions: [] }).success).toBe(false);
    expect(
      importBankTransactionsSchema.safeParse({
        transactions: Array.from({ length: 501 }, () => validRow),
      }).success,
    ).toBe(false);
  });
});
