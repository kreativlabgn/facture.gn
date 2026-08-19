import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { REVENUE_SHARE_CAP_PER_CLIENT_CENTIMES_GNF, REVENUE_SHARE_RATE_BPS } from "./revenue-share-grid";

const BPS_DENOMINATOR = 10_000n;

@Injectable()
export class RevenueShareService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // H4, ADR-071 — restreint à practice_admin (action qui crée un enregistrement
  // financier), même restriction déjà appliquée à inviteMember() (F8).
  // Génération manuelle : aucun cron dans ce repo (voir PLAN "Clarifications"),
  // l'appelant choisit explicitement la période à clôturer.
  async generate(practiceId: string, requesterUserId: string, periodMonth: string) {
    await this.assertPracticeAdmin(practiceId, requesterUserId);

    const { start, end } = resolvePeriodBounds(periodMonth);

    const activeMandates = await this.prisma.mandate.findMany({
      where: { practiceId, status: "active" },
    });

    const credits = [];
    for (const mandate of activeMandates) {
      const aggregate = await this.prisma.payment.aggregate({
        where: {
          invoice: { organizationId: mandate.organizationId },
          status: "completed",
          collectedAt: { gte: start, lt: end },
        },
        _sum: { platformFeeAmount: true },
      });
      const grossCommissionCentimes = aggregate._sum.platformFeeAmount ?? 0n;
      const rawShare = (grossCommissionCentimes * BigInt(REVENUE_SHARE_RATE_BPS)) / BPS_DENOMINATOR;
      const creditedAmountCentimes =
        rawShare > REVENUE_SHARE_CAP_PER_CLIENT_CENTIMES_GNF ? REVENUE_SHARE_CAP_PER_CLIENT_CENTIMES_GNF : rawShare;

      // Upsert — idempotent : régénérer la même période met à jour, jamais un
      // doublon (@@unique practiceId+organizationId+periodMonth).
      const credit = await this.prisma.revenueShareCredit.upsert({
        where: {
          practiceId_organizationId_periodMonth: {
            practiceId,
            organizationId: mandate.organizationId,
            periodMonth,
          },
        },
        create: {
          practiceId,
          organizationId: mandate.organizationId,
          periodMonth,
          grossCommissionCentimes,
          creditedAmountCentimes,
        },
        update: { grossCommissionCentimes, creditedAmountCentimes },
      });
      credits.push(credit);
    }

    return credits;
  }

  // Tout membre actif suffit (même discipline que PracticesService.listMembers()
  // — F8 : consultation, pas une action administrative).
  async listByPractice(practiceId: string, requesterUserId: string) {
    const membership = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId: requesterUserId, leftAt: null },
    });
    if (!membership) {
      throw new ForbiddenException("Seul un membre du cabinet peut consulter son revenue share");
    }

    return this.prisma.revenueShareCredit.findMany({ where: { practiceId } });
  }

  private async assertPracticeAdmin(practiceId: string, requesterUserId: string): Promise<void> {
    const membership = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId: requesterUserId, leftAt: null },
    });
    if (!membership || membership.role !== "practice_admin") {
      throw new ForbiddenException("Seul un practice_admin du cabinet peut générer le revenue share");
    }
  }
}

// periodMonth au format "YYYY-MM" — bornes UTC [start, end).
function resolvePeriodBounds(periodMonth: string): { start: Date; end: Date } {
  const [year, month] = periodMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}
