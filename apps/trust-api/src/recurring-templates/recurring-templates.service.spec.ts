import { describe, expect, it, vi } from "vitest";
import { RecurringTemplatesService } from "./recurring-templates.service";

const SAMPLE_LINES = [{ description: "Abonnement mensuel maintenance", quantity: 1, unitPrice: 150_000n }];

function createFakePrisma(overrides: { organization?: any; template?: any } = {}) {
  return {
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(overrides.organization ?? { id: "org-1", regimeFiscal: "tpu" }),
    },
    recurringInvoiceTemplate: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "template-1", ...data })),
      ...overrides.template,
    },
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
        lines: SAMPLE_LINES,
        discountPct: 0,
        intervalDays: 30,
        lastGeneratedAt: null,
        lastKnownRegimeFiscal: "tpu",
      },
    });
    expect(result.id).toBe("template-1");
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
