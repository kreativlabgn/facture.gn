import { describe, expect, it, vi } from "vitest";
import { CommissionBypassEscalationService } from "./commission-bypass-escalation.service";

function createFakePrisma(organizationOverrides: Record<string, unknown> = {}) {
  let orgState: any = {
    id: "org-1",
    commissionBypassLevel: "none",
    commissionBypassProofThresholdOverrideGnf: null,
    ...organizationOverrides,
  };

  const prisma: any = {
    organization: {
      findUniqueOrThrow: vi.fn(() => Promise.resolve(orgState)),
      // Même garde de concurrence que financeableInvoiceWhere (K4/K5) : la clause
      // where sur le niveau attendu protège réellement, pas la lecture en amont.
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
    },
  };
  return { prisma, getOrgState: () => orgState };
}

describe("CommissionBypassEscalationService (G3, ADR-091)", () => {
  it("escalade none → level_1_nudged sur la première détection", async () => {
    const { prisma, getOrgState } = createFakePrisma();
    const service = new CommissionBypassEscalationService(prisma);

    await service.evaluateAndEscalate("org-1", ["round_amount"]);

    expect(getOrgState().commissionBypassLevel).toBe("level_1_nudged");
  });

  it("escalade level_1_nudged → level_2_proof_threshold_lowered sur une détection suivante, pose l'override de seuil", async () => {
    const { prisma, getOrgState } = createFakePrisma({ commissionBypassLevel: "level_1_nudged" });
    const service = new CommissionBypassEscalationService(prisma);

    await service.evaluateAndEscalate("org-1", ["round_amount"]);

    expect(getOrgState().commissionBypassLevel).toBe("level_2_proof_threshold_lowered");
    expect(getOrgState().commissionBypassProofThresholdOverrideGnf).toBe(50_000_000n);
  });

  it("n'escalade jamais au-delà de level_2 automatiquement (Niveau 3/4 exigent Squad Money, jamais automatique)", async () => {
    const { prisma, getOrgState } = createFakePrisma({ commissionBypassLevel: "level_2_proof_threshold_lowered" });
    const service = new CommissionBypassEscalationService(prisma);

    await service.evaluateAndEscalate("org-1", ["round_amount"]);

    expect(getOrgState().commissionBypassLevel).toBe("level_2_proof_threshold_lowered");
  });

  it("ne fait rien si l'organisation est déjà en revue ou restreinte (level_3/level_4)", async () => {
    const { prisma, getOrgState } = createFakePrisma({ commissionBypassLevel: "level_3_under_review" });
    const service = new CommissionBypassEscalationService(prisma);

    await service.evaluateAndEscalate("org-1", ["round_amount"]);

    expect(getOrgState().commissionBypassLevel).toBe("level_3_under_review");
  });

  it("ne fait rien si aucun pattern n'est détecté", async () => {
    const { prisma, getOrgState } = createFakePrisma();
    const service = new CommissionBypassEscalationService(prisma);

    await service.evaluateAndEscalate("org-1", []);

    expect(getOrgState().commissionBypassLevel).toBe("none");
    expect(prisma.organization.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("jamais d'exception propagée si l'escalade échoue — meilleur effort, jamais couplé au paiement", async () => {
    const { prisma } = createFakePrisma();
    prisma.organization.findUniqueOrThrow = vi.fn().mockRejectedValue(new Error("panne DB inattendue"));
    const service = new CommissionBypassEscalationService(prisma);

    await expect(service.evaluateAndEscalate("org-1", ["round_amount"])).resolves.toBeUndefined();
  });

  it("perd la course silencieusement (updateMany count:0) sans erreur — un autre paiement concurrent a déjà fait avancer le niveau", async () => {
    const { prisma, getOrgState } = createFakePrisma();
    // Simule une course : le niveau change entre la lecture et l'écriture.
    let firstCall = true;
    prisma.organization.updateMany = vi.fn(() => {
      if (firstCall) {
        firstCall = false;
        return Promise.resolve({ count: 0 });
      }
      return Promise.resolve({ count: 1 });
    });
    const service = new CommissionBypassEscalationService(prisma);

    await expect(service.evaluateAndEscalate("org-1", ["round_amount"])).resolves.toBeUndefined();
    expect(getOrgState().commissionBypassLevel).toBe("none"); // updateMany mocké, jamais réellement appliqué
  });
});
