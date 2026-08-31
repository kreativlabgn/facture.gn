import type { $Enums } from "@facture-gn/db";
import { describe, expect, it } from "vitest";

import { CUSTOMER_NAME_TOMBSTONE, isRetainedInvoice, retentionExpiryOf } from "./anonymization";

describe("isRetainedInvoice — une facture qui déclenche la conservation légale OHADA", () => {
  it("vrai pour une facture réellement émise (issued / partially_paid / paid / voided)", () => {
    const statuses: $Enums.InvoiceStatus[] = ["issued", "partially_paid", "paid", "voided"];
    for (const status of statuses) {
      expect(isRetainedInvoice({ documentType: "invoice", status })).toBe(true);
    }
  });

  it("faux pour un brouillon, une proforma, un devis ou une facture expirée/convertie", () => {
    expect(isRetainedInvoice({ documentType: "invoice", status: "draft" })).toBe(false);
    expect(isRetainedInvoice({ documentType: "invoice", status: "expired" })).toBe(false);
    expect(isRetainedInvoice({ documentType: "invoice", status: "converted" })).toBe(false);
    expect(isRetainedInvoice({ documentType: "proforma", status: "issued" })).toBe(false);
    expect(isRetainedInvoice({ documentType: "quote", status: "issued" })).toBe(false);
  });
});

describe("retentionExpiryOf — échéance après laquelle name/nif pourront aussi être effacés", () => {
  it("= date de la facture conservée la plus récente + 10 ans", () => {
    const expiry = retentionExpiryOf([
      { documentType: "invoice", status: "paid", issuedAt: new Date("2026-03-10T10:00:00.000Z") },
      { documentType: "invoice", status: "issued", issuedAt: new Date("2027-01-05T09:00:00.000Z") },
      { documentType: "invoice", status: "draft", issuedAt: new Date("2030-01-01T00:00:00.000Z") }, // ignoré
    ]);
    expect(expiry?.toISOString()).toBe("2037-01-05T09:00:00.000Z");
  });

  it("null si aucune facture conservée", () => {
    expect(retentionExpiryOf([{ documentType: "invoice", status: "draft", issuedAt: new Date() }])).toBeNull();
    expect(retentionExpiryOf([])).toBeNull();
  });
});

describe("CUSTOMER_NAME_TOMBSTONE", () => {
  it("est une valeur non vide (customer.name est NOT NULL en base)", () => {
    expect(CUSTOMER_NAME_TOMBSTONE.length).toBeGreaterThan(0);
  });
});
