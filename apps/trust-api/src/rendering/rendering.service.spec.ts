import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RenderingService, b2gReferencesFrom } from "./rendering.service";

// organizationScopedClient() appelle `$extends`, et setOrganizationScope() pose le
// GUC via `$executeRaw`. Le vrai client offre les deux ; un faux qui ne les offre
// pas ne teste pas le service migré, il plante dessus. `$extends` rend le client
// LUI-MÊME pour que les mocks restent partagés. `$transaction` bi-forme : la forme
// tableau est celle qu'emploie makeScopedOperation(), ce qui rend l'extension
// rejouable — indispensable pour épingler la VALEUR du client scopé.
function auClientScope<T extends Record<string, unknown>>(prisma: T): T {
  const p = prisma as Record<string, unknown>;
  p.$extends = vi.fn(() => prisma);
  p.$executeRaw = p.$executeRaw ?? vi.fn().mockResolvedValue(1);
  p.$transaction = p.$transaction ?? vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  for (const valeur of Object.values(p)) {
    const modele = valeur as Record<string, unknown> | null;
    if (!modele || typeof modele !== "object") continue;
    if (modele.findUniqueOrThrow && !modele.findFirstOrThrow) modele.findFirstOrThrow = modele.findUniqueOrThrow;
    if (modele.findUnique && !modele.findFirst) modele.findFirst = modele.findUnique;
  }
  return prisma;
}

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
    referenceMarche: null,
    numeroBonCommande: null,
    numeroContrat: null,
    numeroEngagement: null,
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
  return auClientScope({
    invoice: { findUnique: vi.fn(async () => invoice) },
    payment: { findUnique: vi.fn(async () => payment) },
  });
}

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString() === "%PDF-" && buffer.length > 1000;
}

describe("RenderingService — scope RLS", () => {
  // Épinglage du CLIENT SCOPÉ : les faux `$extends` de ce dépôt se renvoient
  // eux-mêmes, donc la valeur du scope n'est pas observable directement. On
  // rejoue l'extension capturée — `$allOperations` exécute le set_config via
  // `$executeRaw` — pour lire l'organisation réellement injectée.
  it("pose app.current_org_id sur l'organisation de la facture rendue", async () => {
    const prisma = fakePrisma(issuedInvoice());
    const service = new RenderingService(prisma as any);

    await service.renderInvoicePdf("inv-1", "org-a-proteger");

    const extension = (prisma as any).$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });

    const setConfig = (prisma as any).$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-a-proteger");
  });
});

describe("RenderingService.renderInvoicePdf", () => {
  it("refuse un brouillon (pas encore certifié)", async () => {
    const prisma = fakePrisma(issuedInvoice({ status: "draft", certificationId: null, number: null }));
    const service = new RenderingService(prisma as never);
    await expect(service.renderInvoicePdf("inv-1", "org-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuse un proforma ou un devis", async () => {
    const prisma = fakePrisma(issuedInvoice({ documentType: "proforma" }));
    const service = new RenderingService(prisma as never);
    await expect(service.renderInvoicePdf("inv-1", "org-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("404 si la facture n'existe pas", async () => {
    const service = new RenderingService(fakePrisma(null) as never);
    await expect(service.renderInvoicePdf("inv-x", "org-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("produit un PDF pour une facture émise", async () => {
    const service = new RenderingService(fakePrisma(issuedInvoice()) as never);
    expect(isPdf((await service.renderInvoicePdf("inv-1", "org-1")).pdf)).toBe(true);
  });

  it("produit un PDF pour une facture annulée (garde son numéro et sa certification)", async () => {
    const service = new RenderingService(fakePrisma(issuedInvoice({ status: "voided" })) as never);
    expect(isPdf((await service.renderInvoicePdf("inv-1", "org-1")).pdf)).toBe(true);
  });

  it("produit un PDF valide pour une facture de marché public avec références B2G (Lot C)", async () => {
    // Le contenu rendu (bloc "Références", codes) est vérifié dans
    // document-renderer.spec — ici on garde le chemin service→renderer contre une
    // régression de câblage (mapping des champs Invoice → b2gReferences).
    const service = new RenderingService(
      fakePrisma(
        issuedInvoice({
          cadreFacturation: "marche_public",
          referenceMarche: "TELEMO-2026-000123",
          numeroBonCommande: "BC-MEF-2026-0042",
          numeroContrat: null,
          numeroEngagement: "ENG-2026-00931",
        }),
      ) as never,
    );

    expect(isPdf((await service.renderInvoicePdf("inv-1", "org-1")).pdf)).toBe(true);
  });

});

describe("b2gReferencesFrom (Lot C)", () => {
  it("ne garde que les références non-nulles et non vides", () => {
    expect(
      b2gReferencesFrom({
        referenceMarche: "TELEMO-1",
        numeroBonCommande: "",
        numeroContrat: null,
        numeroEngagement: "ENG-9",
      }),
    ).toEqual([
      { label: "Référence marché", value: "TELEMO-1" },
      { label: "N° d'engagement", value: "ENG-9" },
    ]);
  });

  it("renvoie un tableau vide quand aucune référence n'est renseignée", () => {
    expect(
      b2gReferencesFrom({ referenceMarche: null, numeroBonCommande: null, numeroContrat: null, numeroEngagement: null }),
    ).toEqual([]);
  });
});

describe("RenderingService.renderReceiptPdf", () => {
  it("refuse un paiement qui appartient à une autre facture (IDOR)", async () => {
    const prisma = fakePrisma(issuedInvoice(), completedPayment({ invoiceId: "autre-facture" }));
    const service = new RenderingService(prisma as never);
    await expect(service.renderReceiptPdf("inv-1", "pay-1", "org-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuse un paiement non finalisé", async () => {
    const prisma = fakePrisma(issuedInvoice(), completedPayment({ status: "pending" }));
    const service = new RenderingService(prisma as never);
    await expect(service.renderReceiptPdf("inv-1", "pay-1", "org-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("404 si le paiement n'existe pas", async () => {
    const prisma = fakePrisma(issuedInvoice(), null);
    const service = new RenderingService(prisma as never);
    await expect(service.renderReceiptPdf("inv-1", "pay-x", "org-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("produit un PDF pour un paiement cash finalisé", async () => {
    const prisma = fakePrisma(issuedInvoice(), completedPayment());
    const service = new RenderingService(prisma as never);
    expect(isPdf((await service.renderReceiptPdf("inv-1", "pay-1", "org-1")).pdf)).toBe(true);
  });

  it("produit un PDF pour un paiement Mobile Money avec référence de transaction", async () => {
    const prisma = fakePrisma(
      issuedInvoice(),
      completedPayment({ method: "payment_link", providerSubMethod: "orange_money", providerRef: "DJOMY-TX-1", platformFeeAmount: 17_500_00n, amountCollected: 517_500_00n }),
    );
    const service = new RenderingService(prisma as never);
    expect(isPdf((await service.renderReceiptPdf("inv-1", "pay-1", "org-1")).pdf)).toBe(true);
  });
});
