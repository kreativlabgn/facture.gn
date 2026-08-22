import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RevenueShareService } from "./revenue-share.service";

function createFakePrisma(
  overrides: {
    requesterMembership?: any;
    mandates?: any[];
    platformFeeSum?: bigint | null;
    credits?: any[];
    existingCredit?: any;
    practice?: any;
    creditedSum?: bigint | null;
  } = {},
) {
  return {
    practiceMember: {
      findFirst: vi.fn().mockResolvedValue(
        "requesterMembership" in overrides
          ? overrides.requesterMembership
          : { role: "practice_admin", leftAt: null },
      ),
    },
    mandate: {
      findMany: vi.fn().mockResolvedValue(overrides.mandates ?? []),
    },
    payment: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { platformFeeAmount: overrides.platformFeeSum ?? null } }),
    },
    revenueShareCredit: {
      findUnique: vi.fn().mockResolvedValue(overrides.existingCredit ?? null),
      upsert: vi.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: "credit-1", ...create })),
      findMany: vi.fn().mockResolvedValue(overrides.credits ?? []),
      aggregate: vi.fn().mockResolvedValue({ _sum: { creditedAmountCentimes: overrides.creditedSum ?? null } }),
    },
    professionalPractice: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(
        overrides.practice ?? { id: "practice-1", tier: "partner_starter", revenueShareSettlementMode: "payout" },
      ),
    },
  };
}

describe("RevenueShareService.generate (H4, ADR-071)", () => {
  it("rejette un demandeur qui n'est pas practice_admin", async () => {
    const prisma = createFakePrisma({ requesterMembership: { role: "accountant_external", leftAt: null } });
    const service = new RevenueShareService(prisma as any);

    await expect(service.generate("practice-1", "user-1", "2026-08")).rejects.toThrow(ForbiddenException);
    expect(prisma.mandate.findMany).not.toHaveBeenCalled();
  });

  it("rejette un demandeur qui n'est pas membre de la pratique", async () => {
    const prisma = createFakePrisma({ requesterMembership: null });
    const service = new RevenueShareService(prisma as any);

    await expect(service.generate("practice-1", "user-1", "2026-08")).rejects.toThrow(ForbiddenException);
  });

  it("calcule 10% de la commission perçue sur la période pour un mandat actif", async () => {
    const prisma = createFakePrisma({
      mandates: [{ id: "mandate-1", practiceId: "practice-1", organizationId: "org-1", status: "active" }],
      platformFeeSum: 80_000n,
    });
    const service = new RevenueShareService(prisma as any);

    const result = await service.generate("practice-1", "user-1", "2026-08");

    expect(prisma.revenueShareCredit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          practiceId: "practice-1",
          organizationId: "org-1",
          periodMonth: "2026-08",
          grossCommissionCentimes: 80_000n,
          creditedAmountCentimes: 8_000n,
        }),
      }),
    );
    expect(result[0].creditedAmountCentimes).toBe(8_000n);
  });

  it("plafonne à 500_000n centimes même si 10% dépasse ce montant", async () => {
    const prisma = createFakePrisma({
      mandates: [{ id: "mandate-1", practiceId: "practice-1", organizationId: "org-1", status: "active" }],
      platformFeeSum: 10_000_000n, // 10% = 1_000_000n, au-delà du plafond
    });
    const service = new RevenueShareService(prisma as any);

    await service.generate("practice-1", "user-1", "2026-08");

    expect(prisma.revenueShareCredit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ creditedAmountCentimes: 500_000n }) }),
    );
  });

  it("filtre les paiements sur la période demandée et le statut completed", async () => {
    const prisma = createFakePrisma({
      mandates: [{ id: "mandate-1", practiceId: "practice-1", organizationId: "org-1", status: "active" }],
      platformFeeSum: 10_000n,
    });
    const service = new RevenueShareService(prisma as any);

    await service.generate("practice-1", "user-1", "2026-08");

    expect(prisma.payment.aggregate).toHaveBeenCalledWith({
      where: {
        invoice: { organizationId: "org-1" },
        status: "completed",
        collectedAt: { gte: new Date("2026-08-01T00:00:00.000Z"), lt: new Date("2026-09-01T00:00:00.000Z") },
      },
      _sum: { platformFeeAmount: true },
    });
  });

  it("ignore les mandats non actifs (pending/revoked/expired)", async () => {
    const prisma = createFakePrisma({ mandates: [] });
    const service = new RevenueShareService(prisma as any);

    await service.generate("practice-1", "user-1", "2026-08");

    expect(prisma.mandate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ practiceId: "practice-1", status: "active" }) }),
    );
    expect(prisma.revenueShareCredit.upsert).not.toHaveBeenCalled();
  });

  it("régénère la même période via upsert — jamais un create nu qui dupliquerait", async () => {
    const prisma = createFakePrisma({
      mandates: [{ id: "mandate-1", practiceId: "practice-1", organizationId: "org-1", status: "active" }],
      platformFeeSum: 50_000n,
    });
    const service = new RevenueShareService(prisma as any);

    await service.generate("practice-1", "user-1", "2026-08");

    expect(prisma.revenueShareCredit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          practiceId_organizationId_periodMonth: {
            practiceId: "practice-1",
            organizationId: "org-1",
            periodMonth: "2026-08",
          },
        },
      }),
    );
  });

  it("ne touche jamais un crédit déjà marqué paid — jamais un montant payé silencieusement changé", async () => {
    const prisma = createFakePrisma({
      mandates: [{ id: "mandate-1", practiceId: "practice-1", organizationId: "org-1", status: "active" }],
      platformFeeSum: 999_999n, // montant différent de l'existant, ne doit jamais écraser
      existingCredit: {
        id: "credit-existing",
        practiceId: "practice-1",
        organizationId: "org-1",
        periodMonth: "2026-08",
        status: "paid",
        creditedAmountCentimes: 8_000n,
      },
    });
    const service = new RevenueShareService(prisma as any);

    const result = await service.generate("practice-1", "user-1", "2026-08");

    expect(prisma.revenueShareCredit.upsert).not.toHaveBeenCalled();
    expect(prisma.payment.aggregate).not.toHaveBeenCalled();
    expect(result[0]).toEqual(
      expect.objectContaining({ id: "credit-existing", status: "paid", creditedAmountCentimes: 8_000n }),
    );
  });

  it("reste status pending — jamais marqué payé automatiquement (aucune exécution Djomy Payout réelle)", async () => {
    const prisma = createFakePrisma({
      mandates: [{ id: "mandate-1", practiceId: "practice-1", organizationId: "org-1", status: "active" }],
      platformFeeSum: 50_000n,
    });
    const service = new RevenueShareService(prisma as any);

    const result = await service.generate("practice-1", "user-1", "2026-08");

    expect(result[0].status).toBeUndefined(); // pas fabriqué côté service — @default(pending) du schema s'applique
    expect(prisma.revenueShareCredit.upsert.mock.calls[0][0].create).not.toHaveProperty("status");
  });
});

describe("RevenueShareService.listByPractice (H4, ADR-071)", () => {
  it("rejette un demandeur qui n'est pas membre actif de la pratique", async () => {
    const prisma = createFakePrisma({ requesterMembership: null });
    const service = new RevenueShareService(prisma as any);

    await expect(service.listByPractice("practice-1", "user-1")).rejects.toThrow(ForbiddenException);
  });

  it("autorise tout membre actif, pas seulement practice_admin", async () => {
    const prisma = createFakePrisma({
      requesterMembership: { role: "accountant_external", leftAt: null },
      credits: [{ id: "credit-1", practiceId: "practice-1" }],
    });
    const service = new RevenueShareService(prisma as any);

    const result = await service.listByPractice("practice-1", "user-1");

    expect(result).toHaveLength(1);
  });
});

describe("RevenueShareService.getPartnerSubscriptionStatus (H3, ADR-071, Grille-Offres §5.2)", () => {
  it("mode payout : amountDueCentimes = prix plein du palier, indépendant des crédits générés", async () => {
    const prisma = createFakePrisma({
      practice: { id: "practice-1", tier: "partner_starter", revenueShareSettlementMode: "payout" },
      creditedSum: 30_000_000n,
    });
    const service = new RevenueShareService(prisma as any);

    const result = await service.getPartnerSubscriptionStatus("practice-1", "user-1", "2026-08");

    expect(result.amountDueCentimes).toBe(50_000_000n);
  });

  it("mode subscription_deduction : amountDueCentimes = prix - total crédité, quand total < prix", async () => {
    const prisma = createFakePrisma({
      practice: { id: "practice-1", tier: "partner_starter", revenueShareSettlementMode: "subscription_deduction" },
      creditedSum: 30_000_000n,
    });
    const service = new RevenueShareService(prisma as any);

    const result = await service.getPartnerSubscriptionStatus("practice-1", "user-1", "2026-08");

    expect(result.amountDueCentimes).toBe(20_000_000n);
  });

  it("mode subscription_deduction : amountDueCentimes = 0n (jamais négatif) quand total crédité ≥ prix", async () => {
    const prisma = createFakePrisma({
      practice: { id: "practice-1", tier: "partner_starter", revenueShareSettlementMode: "subscription_deduction" },
      creditedSum: 90_000_000n,
    });
    const service = new RevenueShareService(prisma as any);

    const result = await service.getPartnerSubscriptionStatus("practice-1", "user-1", "2026-08");

    expect(result.amountDueCentimes).toBe(0n);
  });

  it("palier partner_institutional : amountDueCentimes toujours null, quel que soit le mode", async () => {
    const prisma = createFakePrisma({
      practice: {
        id: "practice-1",
        tier: "partner_institutional",
        revenueShareSettlementMode: "subscription_deduction",
      },
      creditedSum: 0n,
    });
    const service = new RevenueShareService(prisma as any);

    const result = await service.getPartnerSubscriptionStatus("practice-1", "user-1", "2026-08");

    expect(result.amountDueCentimes).toBeNull();
  });

  it("refuse un non-membre de la practice (ForbiddenException)", async () => {
    const prisma = createFakePrisma({ requesterMembership: null });
    const service = new RevenueShareService(prisma as any);

    await expect(service.getPartnerSubscriptionStatus("practice-1", "user-1", "2026-08")).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("accepte tout membre actif, pas seulement practice_admin (consultation)", async () => {
    const prisma = createFakePrisma({
      requesterMembership: { role: "accountant_external", leftAt: null },
      practice: { id: "practice-1", tier: "partner_free", revenueShareSettlementMode: "payout" },
    });
    const service = new RevenueShareService(prisma as any);

    await expect(service.getPartnerSubscriptionStatus("practice-1", "user-1", "2026-08")).resolves.toBeDefined();
  });
});
