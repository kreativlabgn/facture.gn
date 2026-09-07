import { describe, expect, it, vi } from "vitest";

// organizationScopedClient() appelle `$extends` sur le client. Le vrai client
// l'offre ; un faux qui ne l'offre pas ne teste pas le service migré, il plante
// dessus. `$extends` rend ici le client LUI-MÊME, pour que les mocks de modèle
// restent partagés et les assertions existantes sur les arguments inchangées.
// (La pose effective du set_config est couverte par packages/db rls.spec.ts.)
function auClientScope<T extends Record<string, unknown>>(prisma: T): T {
  const p = prisma as Record<string, unknown>;
  p.$extends = vi.fn(() => prisma);
  p.$executeRaw = p.$executeRaw ?? vi.fn().mockResolvedValue(1);
  for (const valeur of Object.values(p)) {
    const modele = valeur as Record<string, unknown> | null;
    if (!modele || typeof modele !== "object") continue;
    if (modele.findUniqueOrThrow && !modele.findFirstOrThrow) modele.findFirstOrThrow = modele.findUniqueOrThrow;
    if (modele.findUnique && !modele.findFirst) modele.findFirst = modele.findUnique;
  }
  return prisma;
}
import { UssdPaymentService } from "./ussd-payment.service";

const ORG_ID = "org-1";
const NUMBER = "FG-2026-000001";

function createFakePrisma(overrides: { invoice?: any; organization?: any } = {}) {
  return auClientScope({
    invoice: {
      findFirst: vi.fn().mockResolvedValue(overrides.invoice ?? null),
    },
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(overrides.organization ?? { id: ORG_ID, commercialTier: "freemium" }),
    },
  });
}

function createFakeInvoicesService() {
  return {
    regeneratePaymentLink: vi.fn().mockResolvedValue({ id: "inv-1", paymentLinkUrl: "https://stub.djomy.africa/pay/x" }),
  };
}

describe("UssdPaymentService — recherche d'une facture payable (§2.1 Spec USSD)", () => {
  it("trouve une facture issued par son numéro, scopée à l'organisation", async () => {
    const prisma = createFakePrisma({ invoice: { id: "inv-1", number: NUMBER, status: "issued", amountDue: 500_000n } });
    const service = new UssdPaymentService(prisma as any, createFakeInvoicesService() as any);

    const result = await service.findPayableInvoice(ORG_ID, NUMBER);

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, number: NUMBER, status: { in: ["issued", "partially_paid"] } },
    });
    expect(result?.id).toBe("inv-1");
  });

  it("retourne null si aucune facture ne correspond (inconnue ou déjà soldée/annulée)", async () => {
    const prisma = createFakePrisma({ invoice: null });
    const service = new UssdPaymentService(prisma as any, createFakeInvoicesService() as any);

    await expect(service.findPayableInvoice(ORG_ID, NUMBER)).resolves.toBeNull();
  });
});

describe("UssdPaymentService — aperçu du frais (ADR-074)", () => {
  it("calcule le frais plateforme selon le palier commercial de l'organisation", async () => {
    const prisma = createFakePrisma({ organization: { id: ORG_ID, commercialTier: "pro" } });
    const service = new UssdPaymentService(prisma as any, createFakeInvoicesService() as any);

    const fee = await service.previewFee(ORG_ID, 1_500_000n);

    // 1,5% pro (commission-grid.ts) de 1 500 000 = 22 500.
    expect(fee).toBe(22_500n);
  });
});

describe("UssdPaymentService — confirmation (délègue à C18)", () => {
  it("délègue à InvoicesService.regeneratePaymentLink", async () => {
    const invoicesService = createFakeInvoicesService();
    const service = new UssdPaymentService(createFakePrisma() as any, invoicesService as any);

    await service.confirmPayment("inv-1", "user-1", "org-1");

    expect(invoicesService.regeneratePaymentLink).toHaveBeenCalledWith("inv-1", "user-1", "org-1");
  });
});
