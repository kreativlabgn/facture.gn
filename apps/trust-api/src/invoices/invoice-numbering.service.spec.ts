import { describe, expect, it } from "vitest";
import { formatInvoiceNumber } from "./invoice-numbering.service";

describe("formatInvoiceNumber", () => {
  it("formate FG-YYYY-NNNNNN avec padding à 6 chiffres", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("FG-2026-000001");
    expect(formatInvoiceNumber(2026, 42)).toBe("FG-2026-000042");
    expect(formatInvoiceNumber(2026, 123456)).toBe("FG-2026-123456");
  });

  it("rejette un lastNumber non positif — jamais de FG-YYYY-000000", () => {
    expect(() => formatInvoiceNumber(2026, 0)).toThrow();
    expect(() => formatInvoiceNumber(2026, -1)).toThrow();
  });
});
