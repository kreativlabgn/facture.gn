import { describe, expect, it } from "vitest";
import {
  buildInvoiceDocDefinition,
  buildReceiptDocDefinition,
  type InvoiceRenderInput,
  type ReceiptRenderInput,
} from "./document-renderer";
import { formatGnf } from "./money-format";

const QR_STUB = "data:image/png;base64,AAAA";

function invoiceInput(overrides: Partial<InvoiceRenderInput> = {}): InvoiceRenderInput {
  return {
    organization: { name: "Boutique Aissatou", nif: "123456789", rccm: "GC-KAL-2024-B-001" },
    customer: { name: "Mamadou Diallo", phone: "+224620000000", nif: null },
    number: "FG-2026-000042",
    issuedAt: new Date("2026-03-12T14:30:00Z"),
    certificationId: "GN-12345678-2026-ABC123",
    status: "issued",
    discountPct: 0,
    lines: [
      { description: "Sac de riz 25kg", quantity: 3, unitPrice: 350_000_00n },
      { description: "Bidon d'huile 5L", quantity: 2, unitPrice: 75_000_00n },
    ],
    // valeurs indicatives — le renderer ne recalcule rien, il affiche ce qu'on lui passe
    totalHt: 1_016_949_15n,
    totalTva: 183_050_85n,
    totalTtc: 1_200_000_00n,
    legalMentions: ["TVA au taux de 18 % incluse dans le montant TTC.", "Retard de paiement : pénalités exigibles."],
    verificationUrl: "https://verify.facture.gn/GN-12345678-2026-ABC123",
    qrDataUrl: QR_STUB,
    ...overrides,
  };
}

describe("buildInvoiceDocDefinition", () => {
  it("est déterministe — deux appels avec le même input produisent un objet identique", () => {
    const input = invoiceInput();
    expect(JSON.stringify(buildInvoiceDocDefinition(input))).toBe(
      JSON.stringify(buildInvoiceDocDefinition(input)),
    );
  });

  it("porte le numéro, l'identifiant de certification et la date d'émission formatée", () => {
    const json = JSON.stringify(buildInvoiceDocDefinition(invoiceInput()));
    expect(json).toContain("FG-2026-000042");
    expect(json).toContain("GN-12345678-2026-ABC123");
    expect(json).toContain("12/03/2026");
  });

  it("liste chaque ligne et affiche le total TTC formaté", () => {
    const json = JSON.stringify(buildInvoiceDocDefinition(invoiceInput()));
    expect(json).toContain("Sac de riz 25kg");
    expect(json).toContain("Bidon d'huile 5L");
    expect(json).toContain(formatGnf(1_200_000_00n));
  });

  it("affiche le NIF de l'organisation, jamais un placeholder quand il est absent", () => {
    const withNif = JSON.stringify(buildInvoiceDocDefinition(invoiceInput()));
    expect(withNif).toContain("123456789");

    const withoutNif = JSON.stringify(
      buildInvoiceDocDefinition(invoiceInput({ organization: { name: "PME sans NIF", nif: null } })),
    );
    expect(withoutNif).not.toContain("UNVERIFIED");
    expect(withoutNif).toMatch(/en cours de v[ée]rification/i);
  });

  it("inclut le bloc client seulement si un client est fourni", () => {
    const withCustomer = JSON.stringify(buildInvoiceDocDefinition(invoiceInput()));
    expect(withCustomer).toContain("Mamadou Diallo");

    const withoutCustomer = JSON.stringify(buildInvoiceDocDefinition(invoiceInput({ customer: null })));
    expect(withoutCustomer).not.toContain("Mamadou Diallo");
  });

  it("affiche une ligne de remise seulement si discountPct > 0 et l'écart de montant est réel", () => {
    const noDiscount = JSON.stringify(buildInvoiceDocDefinition(invoiceInput({ discountPct: 0 })));
    expect(noDiscount).not.toMatch(/remise/i);

    // brut des lignes = 3×350 000 + 2×75 000 = 1 200 000 GNF ; remise 10 % → net 1 080 000
    const withDiscount = JSON.stringify(
      buildInvoiceDocDefinition(invoiceInput({ discountPct: 10, totalTtc: 1_080_000_00n })),
    );
    expect(withDiscount).toMatch(/remise/i);
    expect(withDiscount).toContain("10 %");
    expect(withDiscount).toContain(formatGnf(120_000_00n)); // montant de la remise

    // Garde : discountPct enregistré mais aucun écart de montant (données
    // retouchées) → pas de ligne "- -0 GNF".
    const inconsistent = JSON.stringify(
      buildInvoiceDocDefinition(invoiceInput({ discountPct: 10, totalTtc: 1_200_000_00n })),
    );
    expect(inconsistent).not.toMatch(/remise/i);
  });

  it("appose un filigrane ANNULÉE si et seulement si le statut est voided", () => {
    const issued = JSON.stringify(buildInvoiceDocDefinition(invoiceInput({ status: "issued" })));
    expect(issued).not.toContain("ANNUL");

    const voided = JSON.stringify(buildInvoiceDocDefinition(invoiceInput({ status: "voided" })));
    expect(voided).toContain("ANNUL");
  });

  it("porte les mentions légales et l'URL de vérification", () => {
    const json = JSON.stringify(buildInvoiceDocDefinition(invoiceInput()));
    expect(json).toContain("TVA au taux de 18");
    expect(json).toContain("https://verify.facture.gn/GN-12345678-2026-ABC123");
  });
});

function receiptInput(overrides: Partial<ReceiptRenderInput> = {}): ReceiptRenderInput {
  return {
    invoiceNumber: "FG-2026-000042",
    certificationId: "GN-12345678-2026-ABC123",
    organizationName: "Boutique Aissatou",
    payment: {
      method: "cash",
      depositType: null,
      amount: 500_000_00n,
      amountCollected: 500_000_00n,
      platformFeeAmount: 0n,
      gatewayFeeAmount: 0n,
      providerRef: null,
      providerSubMethod: null,
      collectedAt: new Date("2026-03-12T15:00:00Z"),
    },
    invoiceAfter: { amountPaid: 500_000_00n, amountDue: 700_000_00n, totalTtc: 1_200_000_00n },
    verificationUrl: "https://verify.facture.gn/GN-12345678-2026-ABC123",
    qrDataUrl: QR_STUB,
    ...overrides,
  };
}

describe("buildReceiptDocDefinition", () => {
  it("est déterministe", () => {
    const input = receiptInput();
    expect(JSON.stringify(buildReceiptDocDefinition(input))).toBe(
      JSON.stringify(buildReceiptDocDefinition(input)),
    );
  });

  it("libelle le mode de paiement en clair selon la méthode", () => {
    expect(JSON.stringify(buildReceiptDocDefinition(receiptInput({ payment: { ...receiptInput().payment, method: "cash" } })))).toMatch(/esp[èe]ces/i);
    expect(JSON.stringify(buildReceiptDocDefinition(receiptInput({ payment: { ...receiptInput().payment, method: "bank_transfer" } })))).toMatch(/virement/i);
    expect(JSON.stringify(buildReceiptDocDefinition(receiptInput({ payment: { ...receiptInput().payment, method: "payment_link", providerSubMethod: "orange_money" } })))).toMatch(/mobile money/i);
  });

  it("mentionne explicitement qu'une arrhes n'est pas imputée au solde de la facture", () => {
    const json = JSON.stringify(
      buildReceiptDocDefinition(receiptInput({ payment: { ...receiptInput().payment, depositType: "arrhes" } })),
    );
    expect(json).toMatch(/arrhes/i);
    expect(json).toMatch(/non imput/i);
  });

  it("affiche la référence de transaction du provider quand elle est présente", () => {
    const json = JSON.stringify(
      buildReceiptDocDefinition(
        receiptInput({ payment: { ...receiptInput().payment, method: "payment_link", providerRef: "DJOMY-TX-987654" } }),
      ),
    );
    expect(json).toContain("DJOMY-TX-987654");
  });

  it("porte le numéro de facture et le solde restant après paiement", () => {
    const json = JSON.stringify(buildReceiptDocDefinition(receiptInput()));
    expect(json).toContain("FG-2026-000042");
    expect(json).toContain(formatGnf(700_000_00n));
  });
});
