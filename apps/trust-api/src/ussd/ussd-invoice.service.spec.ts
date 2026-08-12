import { describe, expect, it, vi } from "vitest";
import { UssdInvoiceService } from "./ussd-invoice.service";

const USER_ID = "user-1";
const ORG_ID = "org-1";
const PHONE = "+224622334455";

function createFakePrisma(overrides: { customer?: any } = {}) {
  return {
    customer: {
      findFirst: vi.fn().mockResolvedValue(overrides.customer ?? null),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "customer-1", ...data })),
    },
  };
}

function createFakeOrganizationsService(memberships: any[] = []) {
  return { listMine: vi.fn().mockResolvedValue(memberships) };
}

function createFakeInvoicesService() {
  return {
    createDraft: vi.fn().mockResolvedValue({ id: "inv-1" }),
    issue: vi.fn().mockResolvedValue({ id: "inv-1", number: "FG-2026-000001", certificationId: "GN-GN123456-2026-ABCDEF" }),
  };
}

describe("UssdInvoiceService — résolution de l'organisation d'émission", () => {
  it("retourne le hint fourni tel quel (chemin code compte, déjà validé)", async () => {
    const service = new UssdInvoiceService(
      createFakePrisma() as any,
      createFakeOrganizationsService() as any,
      createFakeInvoicesService() as any,
    );

    const result = await service.resolveOrganizationForEmission(USER_ID, ORG_ID);

    expect(result).toBe(ORG_ID);
  });

  it("résout via le premier membership avec un rôle habilité à émettre", async () => {
    const organizations = createFakeOrganizationsService([
      { id: "org-viewer", role: "client_portal" },
      { id: "org-cashier", role: "cashier" },
    ]);
    const service = new UssdInvoiceService(createFakePrisma() as any, organizations as any, createFakeInvoicesService() as any);

    const result = await service.resolveOrganizationForEmission(USER_ID);

    expect(result).toBe("org-cashier");
  });

  it("retourne null si aucun membership n'a de rôle habilité", async () => {
    const organizations = createFakeOrganizationsService([{ id: "org-viewer", role: "client_portal" }]);
    const service = new UssdInvoiceService(createFakePrisma() as any, organizations as any, createFakeInvoicesService() as any);

    await expect(service.resolveOrganizationForEmission(USER_ID)).resolves.toBeNull();
  });
});

describe("UssdInvoiceService — résolution/création du client (C9, notification automatique)", () => {
  it("retourne undefined si aucun téléphone n'est fourni", async () => {
    const prisma = createFakePrisma();
    const service = new UssdInvoiceService(prisma as any, createFakeOrganizationsService() as any, createFakeInvoicesService() as any);

    await expect(service.resolveOrCreateCustomer(ORG_ID, undefined)).resolves.toBeUndefined();
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it("réutilise un client existant portant déjà ce téléphone", async () => {
    const prisma = createFakePrisma({ customer: { id: "customer-existing", phone: PHONE } });
    const service = new UssdInvoiceService(prisma as any, createFakeOrganizationsService() as any, createFakeInvoicesService() as any);

    const result = await service.resolveOrCreateCustomer(ORG_ID, PHONE);

    expect(result).toBe("customer-existing");
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("crée un client à la volée si aucun n'existe pour ce téléphone", async () => {
    const prisma = createFakePrisma({ customer: null });
    const service = new UssdInvoiceService(prisma as any, createFakeOrganizationsService() as any, createFakeInvoicesService() as any);

    const result = await service.resolveOrCreateCustomer(ORG_ID, PHONE);

    expect(result).toBe("customer-1");
    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: { organizationId: ORG_ID, name: PHONE, phone: PHONE },
    });
  });
});

describe("UssdInvoiceService — émission (D1, §2.4 Spec USSD)", () => {
  it("crée une facture à une seule ligne 'Vente USSD' puis l'émet immédiatement", async () => {
    const invoicesService = createFakeInvoicesService();
    const service = new UssdInvoiceService(createFakePrisma() as any, createFakeOrganizationsService() as any, invoicesService as any);

    const result = await service.emitInvoice(ORG_ID, 500_000n, "customer-1");

    expect(invoicesService.createDraft).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      documentType: "invoice",
      customerId: "customer-1",
      lines: [{ description: "Vente USSD", quantity: 1, unitPrice: 500_000n }],
      discountPct: 0,
    });
    expect(invoicesService.issue).toHaveBeenCalledWith("inv-1");
    expect(result.number).toBe("FG-2026-000001");
  });

  it("émet sans customerId quand aucun téléphone n'a été saisi", async () => {
    const invoicesService = createFakeInvoicesService();
    const service = new UssdInvoiceService(createFakePrisma() as any, createFakeOrganizationsService() as any, invoicesService as any);

    await service.emitInvoice(ORG_ID, 500_000n, undefined);

    expect(invoicesService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: undefined }),
    );
  });
});
