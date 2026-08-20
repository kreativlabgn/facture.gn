import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RecurringTemplatesService } from "./recurring-templates.service";

const SAMPLE_LINES = [{ description: "Abonnement mensuel maintenance", quantity: 1, unitPrice: 150_000n }];
const STORED_LINES = [{ description: "Abonnement mensuel maintenance", quantity: 1, unitPrice: "150000" }];

function createFakePrisma(overrides: { organization?: any; template?: any } = {}) {
  return {
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(overrides.organization ?? { id: "org-1", regimeFiscal: "tpu" }),
    },
    recurringInvoiceTemplate: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "template-1", ...data })),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "template-1", ...data })),
      ...overrides.template,
    },
    invoiceEvent: {
      create: vi.fn().mockResolvedValue({ id: "event-1" }),
    },
  };
}

function baseTemplate(overrides: Record<string, any> = {}) {
  return {
    id: "template-1",
    organizationId: "org-1",
    customerId: "cust-1",
    branchId: null,
    lines: STORED_LINES,
    discountPct: 0,
    intervalDays: 30,
    lastGeneratedAt: null,
    lastKnownRegimeFiscal: "tpu",
    ...overrides,
  };
}

function createFakeInvoicesService(overrides: { createDraft?: any } = {}) {
  return {
    createDraft: overrides.createDraft ?? vi.fn().mockResolvedValue({ id: "invoice-1" }),
  };
}

describe("RecurringTemplatesService.create (I1, ADR-056)", () => {
  it("crée un modèle et capture le régime fiscal actuel comme seule référence de comparaison", async () => {
    const prisma = createFakePrisma({ organization: { id: "org-1", regimeFiscal: "tpu" } });
    const service = new RecurringTemplatesService(prisma as any, {} as any);

    const result = await service.create("org-1", {
      lines: SAMPLE_LINES,
      intervalDays: 30,
      discountPct: 0,
    } as any);

    expect(prisma.recurringInvoiceTemplate.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        customerId: undefined,
        branchId: undefined,
        lines: [{ description: "Abonnement mensuel maintenance", quantity: 1, unitPrice: "150000" }],
        discountPct: 0,
        intervalDays: 30,
        lastGeneratedAt: null,
        lastKnownRegimeFiscal: "tpu",
      },
    });
    expect(result.id).toBe("template-1");
  });

  it("convertit unitPrice (bigint) en string avant écriture — un bigint brut fait planter JSON.stringify sur une colonne Json", async () => {
    const prisma = createFakePrisma();
    const service = new RecurringTemplatesService(prisma as any, {} as any);

    await service.create("org-1", { lines: SAMPLE_LINES, intervalDays: 30, discountPct: 0 } as any);

    const writtenLines = prisma.recurringInvoiceTemplate.create.mock.calls[0][0].data.lines;
    expect(typeof writtenLines[0].unitPrice).toBe("string");
    expect(() => JSON.stringify(writtenLines)).not.toThrow();
  });

  it("accepte customerId et branchId optionnels", async () => {
    const prisma = createFakePrisma();
    const service = new RecurringTemplatesService(prisma as any, {} as any);

    await service.create("org-1", {
      customerId: "cust-1",
      branchId: "branch-1",
      lines: SAMPLE_LINES,
      intervalDays: 30,
      discountPct: 0,
    } as any);

    expect(prisma.recurringInvoiceTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerId: "cust-1", branchId: "branch-1" }) }),
    );
  });
});

describe("RecurringTemplatesService.generate (I1, ADR-056)", () => {
  it("appelle createDraft() avec documentType invoice et unitPrice reconverti en bigint", async () => {
    const prisma = createFakePrisma({ template: { findUniqueOrThrow: vi.fn().mockResolvedValue(baseTemplate()) } });
    const invoicesService = createFakeInvoicesService();
    const service = new RecurringTemplatesService(prisma as any, invoicesService as any);

    await service.generate("template-1", "user-1");

    expect(invoicesService.createDraft).toHaveBeenCalledWith({
      organizationId: "org-1",
      documentType: "invoice",
      customerId: "cust-1",
      branchId: undefined,
      lines: SAMPLE_LINES,
      discountPct: 0,
    });
  });

  it("rejette une génération avant l'intervalle écoulé (ConflictException)", async () => {
    const lastGeneratedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // il y a 5 jours
    const prisma = createFakePrisma({
      template: { findUniqueOrThrow: vi.fn().mockResolvedValue(baseTemplate({ lastGeneratedAt, intervalDays: 30 })) },
    });
    const invoicesService = createFakeInvoicesService();
    const service = new RecurringTemplatesService(prisma as any, invoicesService as any);

    await expect(service.generate("template-1", "user-1")).rejects.toThrow(ConflictException);
    expect(invoicesService.createDraft).not.toHaveBeenCalled();
  });

  it("autorise la génération une fois l'intervalle écoulé", async () => {
    const lastGeneratedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // il y a 31 jours
    const prisma = createFakePrisma({
      template: { findUniqueOrThrow: vi.fn().mockResolvedValue(baseTemplate({ lastGeneratedAt, intervalDays: 30 })) },
    });
    const invoicesService = createFakeInvoicesService();
    const service = new RecurringTemplatesService(prisma as any, invoicesService as any);

    await service.generate("template-1", "user-1");

    expect(invoicesService.createDraft).toHaveBeenCalled();
  });

  it("autorise la toute première génération (lastGeneratedAt null)", async () => {
    const prisma = createFakePrisma({
      template: { findUniqueOrThrow: vi.fn().mockResolvedValue(baseTemplate({ lastGeneratedAt: null })) },
    });
    const invoicesService = createFakeInvoicesService();
    const service = new RecurringTemplatesService(prisma as any, invoicesService as any);

    await service.generate("template-1", "user-1");

    expect(invoicesService.createDraft).toHaveBeenCalled();
  });

  it("émet regime_change quand le régime de l'organisation diffère de lastKnownRegimeFiscal (ADR-056, alerte jamais un mur silencieux)", async () => {
    const prisma = createFakePrisma({
      organization: { id: "org-1", regimeFiscal: "normal_tva" },
      template: { findUniqueOrThrow: vi.fn().mockResolvedValue(baseTemplate({ lastKnownRegimeFiscal: "tpu" })) },
    });
    const invoicesService = createFakeInvoicesService();
    const service = new RecurringTemplatesService(prisma as any, invoicesService as any);

    await service.generate("template-1", "user-1");

    expect(prisma.invoiceEvent.create).toHaveBeenCalledWith({
      data: {
        invoiceId: "invoice-1",
        type: "regime_change",
        actorId: "user-1",
        metadata: { previousRegime: "tpu", newRegime: "normal_tva" },
      },
    });
  });

  it("n'émet aucun événement quand le régime est inchangé", async () => {
    const prisma = createFakePrisma({
      organization: { id: "org-1", regimeFiscal: "tpu" },
      template: { findUniqueOrThrow: vi.fn().mockResolvedValue(baseTemplate({ lastKnownRegimeFiscal: "tpu" })) },
    });
    const invoicesService = createFakeInvoicesService();
    const service = new RecurringTemplatesService(prisma as any, invoicesService as any);

    await service.generate("template-1", "user-1");

    expect(prisma.invoiceEvent.create).not.toHaveBeenCalled();
  });

  it("met à jour lastGeneratedAt et lastKnownRegimeFiscal après succès", async () => {
    const prisma = createFakePrisma({
      organization: { id: "org-1", regimeFiscal: "normal_tva" },
      template: { findUniqueOrThrow: vi.fn().mockResolvedValue(baseTemplate({ lastKnownRegimeFiscal: "tpu" })) },
    });
    const invoicesService = createFakeInvoicesService();
    const service = new RecurringTemplatesService(prisma as any, invoicesService as any);

    await service.generate("template-1", "user-1");

    expect(prisma.recurringInvoiceTemplate.update).toHaveBeenCalledWith({
      where: { id: "template-1" },
      data: { lastGeneratedAt: expect.any(Date), lastKnownRegimeFiscal: "normal_tva" },
    });
  });

  it("rejette (ConflictException, jamais un TypeError opaque) un modèle dont lines est corrompu", async () => {
    const prisma = createFakePrisma({
      template: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue(baseTemplate({ lines: [{ description: "Ligne sans unitPrice", quantity: 1 }] })),
      },
    });
    const invoicesService = createFakeInvoicesService();
    const service = new RecurringTemplatesService(prisma as any, invoicesService as any);

    await expect(service.generate("template-1", "user-1")).rejects.toThrow(ConflictException);
    expect(invoicesService.createDraft).not.toHaveBeenCalled();
  });
});
