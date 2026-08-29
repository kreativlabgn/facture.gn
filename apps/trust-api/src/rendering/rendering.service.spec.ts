import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RenderingService } from "./rendering.service";

const CERT_ID = "GN-12345678-2026-ABC123";

function issuedInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    organizationId: "org-1",
    number: "FG-2026-000042",
    certificationId: CERT_ID,
    documentType: "invoice",
    status: "issued",
    discountPct: 0,
    totalHt: 1_016_949_15n,
    totalTva: 183_050_85n,
    totalTtc: 1_200_000_00n,
    amountPaid: 0n,
    amountDue: 1_200_000_00n,
    issuedAt: new Date("2026-03-12T14:30:00Z"),
    organization: { name: "Boutique Aissatou", nif: "123456789", rccm: null, regimeFiscal: "normal_tva" },
    customer: { name: "Mamadou Diallo", phone: "+224620000000", nif: null },
    lines: [{ description: "Sac de riz 25kg", quantity: 3, unitPrice: 400_000_00n }],
    ...overrides,
  };
}

function completedPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay-1",
    invoiceId: "inv-1",
    method: "cash",
    depositType: null,
    amount: 500_000_00n,
    amountCollected: 500_000_00n,
    platformFeeAmount: 0n,
    gatewayFeeAmount: 0n,
    providerRef: null,
    providerSubMethod: null,
    status: "completed",
    collectedAt: new Date("2026-03-12T15:00:00Z"),
    ...overrides,
  };
}

function fakePrisma(invoice: unknown, payment: unknown = null) {
  return {
    invoice: { findUnique: vi.fn(async () => invoice) },
    payment: { findUnique: vi.fn(async () => payment) },
  };
}

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString() === "%PDF-" && buffer.length > 1000;
}

describe("RenderingService.renderInvoicePdf", () => {
  it("refuse un brouillon (pas encore certifié)", async () => {
    const prisma = fakePrisma(issuedInvoice({ status: "draft", certificationId: null, number: null }));
    const service = new RenderingService(prisma as never);
    await expect(service.renderInvoicePdf("inv-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuse un proforma ou un devis", async () => {
    const prisma = fakePrisma(issuedInvoice({ documentType: "proforma" }));
    const service = new RenderingService(prisma as never);
    await expect(service.renderInvoicePdf("inv-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("404 si la facture n'existe pas", async () => {
    const service = new RenderingService(fakePrisma(null) as never);
    await expect(service.renderInvoicePdf("inv-x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("produit un PDF pour une facture émise", async () => {
    const service = new RenderingService(fakePrisma(issuedInvoice()) as never);
    expect(isPdf((await service.renderInvoicePdf("inv-1")).pdf)).toBe(true);
  });

  it("produit un PDF pour une facture annulée (garde son numéro et sa certification)", async () => {
    const service = new RenderingService(fakePrisma(issuedInvoice({ status: "voided" })) as never);
    expect(isPdf((await service.renderInvoicePdf("inv-1")).pdf)).toBe(true);
  });
});

describe("RenderingService.renderReceiptPdf", () => {
  it("refuse un paiement qui appartient à une autre facture (IDOR)", async () => {
    const prisma = fakePrisma(issuedInvoice(), completedPayment({ invoiceId: "autre-facture" }));
    const service = new RenderingService(prisma as never);
    await expect(service.renderReceiptPdf("inv-1", "pay-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuse un paiement non finalisé", async () => {
    const prisma = fakePrisma(issuedInvoice(), completedPayment({ status: "pending" }));
    const service = new RenderingService(prisma as never);
    await expect(service.renderReceiptPdf("inv-1", "pay-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("404 si le paiement n'existe pas", async () => {
    const prisma = fakePrisma(issuedInvoice(), null);
    const service = new RenderingService(prisma as never);
    await expect(service.renderReceiptPdf("inv-1", "pay-x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("produit un PDF pour un paiement cash finalisé", async () => {
    const prisma = fakePrisma(issuedInvoice(), completedPayment());
    const service = new RenderingService(prisma as never);
    expect(isPdf((await service.renderReceiptPdf("inv-1", "pay-1")).pdf)).toBe(true);
  });

  it("produit un PDF pour un paiement Mobile Money avec référence de transaction", async () => {
    const prisma = fakePrisma(
      issuedInvoice(),
      completedPayment({ method: "payment_link", providerSubMethod: "orange_money", providerRef: "DJOMY-TX-1", platformFeeAmount: 17_500_00n, amountCollected: 517_500_00n }),
    );
    const service = new RenderingService(prisma as never);
    expect(isPdf((await service.renderReceiptPdf("inv-1", "pay-1")).pdf)).toBe(true);
  });
});
