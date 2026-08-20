import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CommissionBypassReviewService } from "./commission-bypass-review.service";

function createFakePrisma(
  organizationOverrides: Record<string, unknown> = {},
  existingCase: any = null,
) {
  let orgState: any = {
    id: "org-1",
    commissionBypassLevel: "level_2_proof_threshold_lowered",
    commissionBypassProofThresholdOverrideGnf: 50_000_000n,
    ...organizationOverrides,
  };
  let caseState: any = existingCase;
  let nextCaseId = 1;

  const prisma: any = {
    organization: {
      findUniqueOrThrow: vi.fn(() => Promise.resolve(orgState)),
      updateMany: vi.fn(({ where, data }: any) => {
        if (
          where.commissionBypassLevel !== undefined &&
          orgState.commissionBypassLevel !== where.commissionBypassLevel
        ) {
          return Promise.resolve({ count: 0 });
        }
        orgState = { ...orgState, ...data };
        return Promise.resolve({ count: 1 });
      }),
      update: vi.fn(({ data }: any) => {
        orgState = { ...orgState, ...data };
        return Promise.resolve(orgState);
      }),
    },
    commissionBypassCase: {
      findFirst: vi.fn(() => Promise.resolve(caseState?.status === "pending" ? caseState : null)),
      findUniqueOrThrow: vi.fn(() => Promise.resolve(caseState)),
      create: vi.fn(({ data }: any) => {
        caseState = { id: `case-${nextCaseId++}`, status: "pending", resolvedAt: null, ...data };
        return Promise.resolve(caseState);
      }),
      updateMany: vi.fn(({ where, data }: any) => {
        if (where.status !== undefined && caseState?.status !== where.status) {
          return Promise.resolve({ count: 0 });
        }
        caseState = { ...caseState, ...data };
        return Promise.resolve({ count: 1 });
      }),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
  };
  return { prisma, getOrgState: () => orgState, getCaseState: () => caseState };
}

describe("CommissionBypassReviewService — ouverture d'un case (G3, ADR-091)", () => {
  it("ouvre un case et fait passer l'organisation à level_3_under_review", async () => {
    const { prisma, getOrgState, getCaseState } = createFakePrisma();
    const service = new CommissionBypassReviewService(prisma);

    const result = await service.openCase("org-1", ["round_amount", "sub_threshold_recurrence"]);

    expect(getOrgState().commissionBypassLevel).toBe("level_3_under_review");
    expect(getCaseState().status).toBe("pending");
    expect(getCaseState().detectedPatterns).toEqual(["round_amount", "sub_threshold_recurrence"]);
    expect(result.status).toBe("pending");
  });

  it("refuse d'ouvrir un case si l'organisation n'est pas à level_2_proof_threshold_lowered", async () => {
    const { prisma } = createFakePrisma({ commissionBypassLevel: "level_1_nudged" });
    const service = new CommissionBypassReviewService(prisma);

    await expect(service.openCase("org-1", ["round_amount"])).rejects.toThrow(ConflictException);
  });

  it("refuse un 2e case en doublon si un case pending existe déjà pour cette organisation", async () => {
    const { prisma } = createFakePrisma(
      {},
      { id: "case-existing", organizationId: "org-1", status: "pending" },
    );
    const service = new CommissionBypassReviewService(prisma);

    await expect(service.openCase("org-1", ["round_amount"])).rejects.toThrow(ConflictException);
  });
});

describe("CommissionBypassReviewService — résolution d'un case (G3, ADR-091)", () => {
  it("dismiss réinitialise l'organisation à none et efface l'override de seuil", async () => {
    const { prisma, getOrgState, getCaseState } = createFakePrisma(
      { commissionBypassLevel: "level_3_under_review" },
      { id: "case-1", organizationId: "org-1", status: "pending" },
    );
    const service = new CommissionBypassReviewService(prisma);

    await service.resolveCase("case-1", "dismiss");

    expect(getCaseState().status).toBe("dismissed");
    expect(getOrgState().commissionBypassLevel).toBe("none");
    expect(getOrgState().commissionBypassProofThresholdOverrideGnf).toBeNull();
  });

  it("restrict pose level_4_restricted sur l'organisation, sans toucher à l'override de seuil", async () => {
    const { prisma, getOrgState, getCaseState } = createFakePrisma(
      { commissionBypassLevel: "level_3_under_review" },
      { id: "case-1", organizationId: "org-1", status: "pending" },
    );
    const service = new CommissionBypassReviewService(prisma);

    await service.resolveCase("case-1", "restrict");

    expect(getCaseState().status).toBe("restricted");
    expect(getOrgState().commissionBypassLevel).toBe("level_4_restricted");
    expect(getOrgState().commissionBypassProofThresholdOverrideGnf).toBe(50_000_000n);
  });

  it("refuse de résoudre un case déjà résolu", async () => {
    const { prisma } = createFakePrisma(
      { commissionBypassLevel: "level_3_under_review" },
      { id: "case-1", organizationId: "org-1", status: "dismissed" },
    );
    const service = new CommissionBypassReviewService(prisma);

    await expect(service.resolveCase("case-1", "dismiss")).rejects.toThrow(ConflictException);
  });
});
