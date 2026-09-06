import { ConflictException, NotFoundException } from "@nestjs/common";
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
      // DEUX lectures findFirst distinctes passent désormais ici, et elles se
      // distinguent par leur `where` :
      //   • { organizationId, status: "pending" } → garde anti-doublon d'openCase
      //   • { id }                                → découverte de resolveCase,
      //     qui doit rendre le case QUEL QUE SOIT son statut (c'est l'updateMany
      //     gardé, ensuite, qui refuse un case déjà résolu).
      findFirst: vi.fn(({ where }: any) =>
        Promise.resolve(
          where?.status === "pending" ? (caseState?.status === "pending" ? caseState : null) : caseState,
        ),
      ),
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
    // organizationScopedClient() appelle $extends ; setOrganizationScope() pose le
    // GUC via $executeRaw en tête de transaction. Ici $transaction rappelle le
    // client lui-même, donc le même objet sert de tx : il doit porter les deux.
    $extends: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  prisma.$extends.mockReturnValue(prisma);
  return { prisma, getOrgState: () => orgState, getCaseState: () => caseState };
}

describe("CommissionBypassReviewService — ouverture d'un case (G3, ADR-091)", () => {
  // Le GUC posé doit être celui de l'organisation NOMMÉE DANS L'URL. Les faux
  // `$extends` se renvoyant eux-mêmes, la valeur du scope n'est pas observable
  // par `$extends` : on lit l'argument réellement passé à setOrganizationScope().
  it("pose app.current_org_id sur l'organisation ciblée, en tête de transaction", async () => {
    const { prisma } = createFakePrisma();
    const service = new CommissionBypassReviewService(prisma);

    await service.openCase("org-1", ["structuring_loop"]);

    const setConfig = prisma.$executeRaw.mock.calls[0]?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-1");
  });


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
  it("pose app.current_org_id sur l'organisation DÉCOUVERTE depuis le case, jamais une autre", async () => {
    const { prisma } = createFakePrisma(
      { id: "org-decouverte", commissionBypassLevel: "level_3_under_review" },
      { id: "case-1", organizationId: "org-decouverte", status: "pending" },
    );
    const service = new CommissionBypassReviewService(prisma);

    await service.resolveCase("case-1", "dismiss", "squad-money-1");

    const setConfig = prisma.$executeRaw.mock.calls[0]?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-decouverte");
  });

  // La lecture de découverte précède le GUC : elle DOIT rester globale, sinon
  // l'organisation ne pourrait jamais être trouvée. Corollaire vérifiable : rien
  // n'est posé avant elle.
  it("ne pose aucun GUC avant la lecture de découverte du case", async () => {
    const { prisma } = createFakePrisma(
      { commissionBypassLevel: "level_3_under_review" },
      { id: "case-1", organizationId: "org-1", status: "pending" },
    );
    const service = new CommissionBypassReviewService(prisma);

    await service.resolveCase("case-1", "dismiss", "squad-money-1");

    const lectureDecouverte = prisma.commissionBypassCase.findFirst.mock.invocationCallOrder[0];
    const premierGuc = prisma.$executeRaw.mock.invocationCallOrder[0];
    expect(lectureDecouverte).toBeLessThan(premierGuc);
  });

  // Comportement corrigé : sans ExceptionFilter dans cette application, le
  // findUniqueOrThrow d'origine remontait en 500 sur un caseId inconnu.
  it("case inexistant → 404 explicite, jamais une erreur serveur opaque", async () => {
    const { prisma } = createFakePrisma({}, null);
    const service = new CommissionBypassReviewService(prisma);

    await expect(service.resolveCase("case-inconnu", "dismiss", "squad-money-1")).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });


  it("dismiss réinitialise l'organisation à none et efface l'override de seuil", async () => {
    const { prisma, getOrgState, getCaseState } = createFakePrisma(
      { commissionBypassLevel: "level_3_under_review" },
      { id: "case-1", organizationId: "org-1", status: "pending" },
    );
    const service = new CommissionBypassReviewService(prisma);

    await service.resolveCase("case-1", "dismiss", "squad-money-1");

    expect(getCaseState().status).toBe("dismissed");
    expect(getCaseState().resolvedByOperatorId).toBe("squad-money-1");
    expect(getOrgState().commissionBypassLevel).toBe("none");
    expect(getOrgState().commissionBypassProofThresholdOverrideGnf).toBeNull();
  });

  it("restrict pose level_4_restricted sur l'organisation, sans toucher à l'override de seuil", async () => {
    const { prisma, getOrgState, getCaseState } = createFakePrisma(
      { commissionBypassLevel: "level_3_under_review" },
      { id: "case-1", organizationId: "org-1", status: "pending" },
    );
    const service = new CommissionBypassReviewService(prisma);

    await service.resolveCase("case-1", "restrict", "squad-money-2");

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

    await expect(service.resolveCase("case-1", "dismiss", "squad-money-1")).rejects.toThrow(ConflictException);
  });
});
