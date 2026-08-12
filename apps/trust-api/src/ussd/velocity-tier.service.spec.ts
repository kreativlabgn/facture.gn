import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { VelocityTierService } from "./velocity-tier.service";

const ORG_ID = "org-1";

function createFakePrisma(overrides: {
  organization?: any;
  anomalyEventCount?: number;
  sums?: { day?: bigint; week?: bigint; month?: bigint };
} = {}) {
  const sums = overrides.sums ?? {};
  let aggregateCall = 0;
  const sumsInOrder = [sums.day ?? 0n, sums.week ?? 0n, sums.month ?? 0n];
  return {
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(
        overrides.organization ?? {
          id: ORG_ID,
          dgiVerificationStatus: "unverified",
          dgiVerifiedAt: null,
          paymentsFrozenUntil: null,
        },
      ),
    },
    invoiceEvent: {
      count: vi.fn().mockResolvedValue(overrides.anomalyEventCount ?? 0),
    },
    invoice: {
      aggregate: vi.fn().mockImplementation(() => {
        const sum = sumsInOrder[aggregateCall] ?? 0n;
        aggregateCall += 1;
        return Promise.resolve({ _sum: { totalTtc: sum } });
      }),
    },
  };
}

describe("VelocityTierService — assertWithinLimits (D4, §4 Spec USSD)", () => {
  it("accepte un montant sous tous les plafonds T0", async () => {
    const prisma = createFakePrisma();
    const service = new VelocityTierService(prisma as any);

    await expect(service.assertWithinLimits(ORG_ID, 10_000_000n)).resolves.toBeUndefined();
  });

  it("refuse un montant qui dépasse le plafond PAR ACTE du palier résolu", async () => {
    const prisma = createFakePrisma(); // T0 : perAct = 50_000_000n
    const service = new VelocityTierService(prisma as any);

    await expect(service.assertWithinLimits(ORG_ID, 60_000_000n)).rejects.toThrow(ForbiddenException);
  });

  it("refuse si la somme déjà émise CE JOUR + ce montant dépasse le plafond journalier", async () => {
    const prisma = createFakePrisma({ sums: { day: 140_000_000n } }); // T0 perDay = 150_000_000n
    const service = new VelocityTierService(prisma as any);

    await expect(service.assertWithinLimits(ORG_ID, 20_000_000n)).rejects.toThrow(/jour/);
  });

  it("refuse si la somme hebdomadaire dépasse son plafond, même si le jour est sous le sien", async () => {
    const prisma = createFakePrisma({ sums: { day: 0n, week: 290_000_000n } }); // T0 perWeek = 300_000_000n
    const service = new VelocityTierService(prisma as any);

    await expect(service.assertWithinLimits(ORG_ID, 20_000_000n)).rejects.toThrow(/semaine/);
  });

  it("refuse si la somme mensuelle dépasse son plafond", async () => {
    const prisma = createFakePrisma({ sums: { day: 0n, week: 0n, month: 590_000_000n } }); // T0 perMonth = 600_000_000n
    const service = new VelocityTierService(prisma as any);

    await expect(service.assertWithinLimits(ORG_ID, 20_000_000n)).rejects.toThrow(/mois/);
  });

  it("applique les plafonds T1 (plus élevés) pour une organisation vérifiée DGI récemment", async () => {
    const prisma = createFakePrisma({
      organization: {
        id: ORG_ID,
        dgiVerificationStatus: "verified",
        dgiVerifiedAt: new Date(Date.now() - 10 * 24 * 3600_000),
        paymentsFrozenUntil: null,
      },
    });
    const service = new VelocityTierService(prisma as any);

    // 60M dépasserait T0 (perAct 50M) mais reste sous T1 (perAct 400M).
    await expect(service.assertWithinLimits(ORG_ID, 60_000_000n)).resolves.toBeUndefined();
  });

  it("force T0 pour une organisation gelée (paymentsFrozenUntil futur), malgré un palier DGI élevé", async () => {
    const prisma = createFakePrisma({
      organization: {
        id: ORG_ID,
        dgiVerificationStatus: "verified",
        dgiVerifiedAt: new Date(Date.now() - 500 * 24 * 3600_000),
        paymentsFrozenUntil: new Date(Date.now() + 3600_000),
      },
    });
    const service = new VelocityTierService(prisma as any);

    await expect(service.assertWithinLimits(ORG_ID, 60_000_000n)).rejects.toThrow(ForbiddenException);
  });
});
