import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RevenueShareService } from "./revenue-share.service";

// practiceScopedClient() appelle `$extends` sur le client. Le vrai client
// l'offre ; un faux qui ne l'offre pas ne teste pas le service migré, il plante
// dessus. `$extends` rend ici le client LUI-MÊME, pour que les mocks de modèle
// restent partagés et les assertions existantes inchangées. `$transaction`
// bi-forme : la forme tableau est celle qu'emploie makeScopedOperation(), ce qui
// rend l'extension rejouable par les tests de scope.
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

function createFakePrisma(
  overrides: {
    requesterMembership?: any;
    mandates?: any[];
    platformFeeSum?: bigint | null;
    payments?: any[];
    credits?: any[];
    existingCredit?: any;
    practice?: any;
    creditedSum?: bigint | null;
  } = {},
) {
  return auClientScope({
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
    // Quality Audit 2026-08-23, finding #13 — payment.aggregate() par mandat
    // remplacé par UN SEUL payment.findMany() (agrégé en JS ensuite) : le
    // raccourci platformFeeSum (toutes les tests existants n'utilisent qu'une
    // seule organisation, "org-1") synthétise la même ligne qu'avant sans
    // devoir réécrire chaque test individuellement ; payments permet un
    // contrôle explicite quand plusieurs organisations sont en jeu.
    payment: {
      findMany: vi.fn().mockResolvedValue(
        overrides.payments ??
          (overrides.platformFeeSum != null
            ? [{ platformFeeAmount: overrides.platformFeeSum, invoice: { organizationId: "org-1" } }]
            : []),
      ),
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
  });
}

describe("RevenueShareService.generate (H4, ADR-071)", () => {
  // Ce module est scopé CABINET de bout en bout. Les faux `$extends` se
  // renvoyant eux-mêmes, la valeur du scope n'est pas observable directement :
  // on rejoue l'extension capturée — `$allOperations` exécute le set_config via
  // `$executeRaw` — pour lire ce qui y a été injecté.
  it("pose app.current_practice_id, et JAMAIS app.current_org_id", async () => {
    const prisma = createFakePrisma({
      mandates: [{ organizationId: "org-1", practiceId: "practice-1" }],
      platformFeeSum: 1_000_000n,
    });
    const service = new RevenueShareService(prisma as any);

    await service.generate("practice-1", "user-1", "2026-08");

    // auClientScope() greffe $extends/$executeRaw dynamiquement : le type
    // littéral rendu par createFakePrisma() ne les porte pas.
    const espion = prisma as any;
    const extension = espion.$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });

    const setConfig = espion.$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("app.current_practice_id");
    expect(setConfig.values).toContain("practice-1");
    // Le scope ORGANISATION serait une erreur de nature ici : les crédits et les
    // mandats portent practice_id, et la vue paiements est transversale aux
    // organisations mandatées. Un app.current_org_id la réduirait à une seule.
    expect(setConfig.values).not.toContain("app.current_org_id");
  });


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

    expect(prisma.payment.findMany).toHaveBeenCalledWith({
      where: {
        invoice: { organizationId: { in: ["org-1"] } },
        status: "completed",
        collectedAt: { gte: new Date("2026-08-01T00:00:00.000Z"), lt: new Date("2026-09-01T00:00:00.000Z") },
      },
      select: { platformFeeAmount: true, invoice: { select: { organizationId: true } } },
    });
  });

  it("agrège correctement les paiements de plusieurs organisations mandantes en une seule requête (Quality Audit 2026-08-23, finding #13)", async () => {
    const prisma = createFakePrisma({
      mandates: [
        { id: "mandate-1", practiceId: "practice-1", organizationId: "org-1", status: "active" },
        { id: "mandate-2", practiceId: "practice-1", organizationId: "org-2", status: "active" },
      ],
      payments: [
        { platformFeeAmount: 50_000n, invoice: { organizationId: "org-1" } },
        { platformFeeAmount: 30_000n, invoice: { organizationId: "org-1" } },
        { platformFeeAmount: 20_000n, invoice: { organizationId: "org-2" } },
      ],
    });
    const service = new RevenueShareService(prisma as any);

    await service.generate("practice-1", "user-1", "2026-08");

    // Une seule requête payment.findMany, pas une par mandat.
    expect(prisma.payment.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.revenueShareCredit.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expect.objectContaining({ organizationId: "org-1", grossCommissionCentimes: 80_000n }),
      }),
    );
    expect(prisma.revenueShareCredit.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: expect.objectContaining({ organizationId: "org-2", grossCommissionCentimes: 20_000n }),
      }),
    );
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
