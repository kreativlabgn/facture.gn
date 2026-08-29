import { describe, expect, it } from "vitest";
import { renderToBuffer } from "./pdf-printer";
import { buildInvoiceDocDefinition, buildReceiptDocDefinition } from "./document-renderer";
import { buildVerificationQrDataUrl } from "./verification-qr";

// Extraction de texte impossible sans parseur PDF (streams compressés) — le rendu
// des accents avec les polices Roboto vendorées a été validé au spike serveur.
// Ici on vérifie qu'un docDefinition produit un PDF binaire structurellement
// valide, y compris avec une image data-URI (chemin du QR de vérification).

function isValidPdf(buffer: Buffer): boolean {
  return buffer.length > 1000 && buffer.subarray(0, 5).toString() === "%PDF-" && buffer.subarray(-6).toString().trim() === "%%EOF";
}

describe("renderToBuffer", () => {
  it("produit un PDF binaire valide à partir d'un docDefinition minimal", async () => {
    const buffer = await renderToBuffer({ content: ["Facture — été à Conakry ç à é"], defaultStyle: { font: "Roboto" } });
    expect(isValidPdf(buffer)).toBe(true);
  });

  it("embarque une image data-URI (QR) sans erreur", async () => {
    const qr = await buildVerificationQrDataUrl("GN-12345678-2026-ABC123");
    const buffer = await renderToBuffer({
      content: [{ image: qr, width: 60 }],
      defaultStyle: { font: "Roboto" },
    });
    expect(isValidPdf(buffer)).toBe(true);
  });

  it("rend une facture complète (renderer + printer bout en bout)", async () => {
    const qr = await buildVerificationQrDataUrl("GN-12345678-2026-ABC123");
    const doc = buildInvoiceDocDefinition({
      organization: { name: "Boutique Aïssatou", nif: "123456789", rccm: "GC-KAL-2024-B-001" },
      customer: { name: "Mamadou Diallo", phone: "+224620000000", nif: null },
      number: "FG-2026-000042",
      issuedAt: new Date("2026-03-12T14:30:00Z"),
      certificationId: "GN-12345678-2026-ABC123",
      status: "issued",
      discountPct: 5,
      lines: [
        { description: "Sac de riz 25kg", quantity: 3, unitPrice: 350_000_00n },
        { description: "Bidon d'huile 5L", quantity: 2, unitPrice: 75_000_00n },
      ],
      totalHt: 1_016_949_15n,
      totalTva: 183_050_85n,
      totalTtc: 1_140_000_00n,
      legalMentions: ["TVA au taux de 18 % incluse dans le montant TTC."],
      verificationUrl: "https://verify.facture.gn/GN-12345678-2026-ABC123",
      qrDataUrl: qr,
    });
    expect(isValidPdf(await renderToBuffer(doc))).toBe(true);
  });

  it("rend un reçu de paiement Mobile Money", async () => {
    const qr = await buildVerificationQrDataUrl("GN-12345678-2026-ABC123");
    const doc = buildReceiptDocDefinition({
      invoiceNumber: "FG-2026-000042",
      certificationId: "GN-12345678-2026-ABC123",
      organizationName: "Boutique Aïssatou",
      payment: {
        method: "payment_link",
        depositType: null,
        amount: 500_000_00n,
        amountCollected: 517_500_00n,
        platformFeeAmount: 17_500_00n,
        gatewayFeeAmount: 0n,
        providerRef: "DJOMY-TX-987654",
        providerSubMethod: "orange_money",
        collectedAt: new Date("2026-03-12T15:00:00Z"),
      },
      invoiceAfter: { amountPaid: 500_000_00n, amountDue: 700_000_00n, totalTtc: 1_200_000_00n },
      verificationUrl: "https://verify.facture.gn/GN-12345678-2026-ABC123",
      qrDataUrl: qr,
    });
    expect(isValidPdf(await renderToBuffer(doc))).toBe(true);
  });
});
