import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { REVENUE_SHARE_CAP_PER_CLIENT_CENTIMES_GNF, REVENUE_SHARE_RATE_BPS } from "./revenue-share-grid";
import { getPartnerTierPrice } from "../practices/partner-tier-grid";
import { mandateNotExpiredWhere } from "../common/rbac/mandate-expiration";
import { assertPracticeAdmin } from "../common/rbac/practice-access";

const BPS_DENOMINATOR = 10_000n;

@Injectable()
export class RevenueShareService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // H4, ADR-071 — restreint à practice_admin (action qui crée un enregistrement
  // financier), même restriction déjà appliquée à inviteMember() (F8).
  // Génération manuelle : aucun cron dans ce repo (voir PLAN "Clarifications"),
  // l'appelant choisit explicitement la période à clôturer.
  async generate(practiceId: string, requesterUserId: string, periodMonth: string) {
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId, "générer le revenue share");

    const { start, end } = resolvePeriodBounds(periodMonth);

    const activeMandates = await this.prisma.mandate.findMany({
      where: { practiceId, status: "active", ...mandateNotExpiredWhere() },
    });

    const credits = [];
    for (const mandate of activeMandates) {
      // Un crédit déjà marqué "paid" (futur mécanisme, pas encore construit)
      // n'est jamais recalculé/écrasé — un paiement tardif ne doit jamais
      // changer silencieusement un montant déjà versé. Trouvé en revue
      // dev-code-reviewer (agent 1, idempotence).
      const existingCredit = await this.prisma.revenueShareCredit.findUnique({
        where: {
          practiceId_organizationId_periodMonth: {
            practiceId,
            organizationId: mandate.organizationId,
            periodMonth,
          },
        },
      });
      if (existingCredit && existingCredit.status === "paid") {
        credits.push(existingCredit);
        continue;
      }

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

  // H3, ADR-071, Grille-Offres §5.2 — vue calculée à la demande, jamais
  // d'entité persistée pour la "facture" d'abonnement (décision utilisateur,
  // voir PLAN "Alternatives écartées"). Tout membre actif suffit (consultation,
  // même discipline que listByPractice()). N'affecte JAMAIS un
  // RevenueShareCredit existant — lecture seule, oriente uniquement le calcul.
  async getPartnerSubscriptionStatus(practiceId: string, requesterUserId: string, periodMonth: string) {
    const membership = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId: requesterUserId, leftAt: null },
    });
    if (!membership) {
      throw new ForbiddenException("Seul un membre du cabinet peut consulter son abonnement Partner");
    }

    const practice = await this.prisma.professionalPractice.findUniqueOrThrow({ where: { id: practiceId } });
    const price = getPartnerTierPrice(practice.tier);

    if (price.kind === "quote_required") {
      return { practiceId, periodMonth, tier: practice.tier, amountDueCentimes: null as bigint | null };
    }

    if (practice.revenueShareSettlementMode === "payout") {
      return { practiceId, periodMonth, tier: practice.tier, amountDueCentimes: price.amountCentimes };
    }

    const aggregate = await this.prisma.revenueShareCredit.aggregate({
      where: { practiceId, periodMonth },
      _sum: { creditedAmountCentimes: true },
    });
    const totalCreditedCentimes = aggregate._sum.creditedAmountCentimes ?? 0n;
    const remaining = price.amountCentimes - totalCreditedCentimes;
    const amountDueCentimes = remaining > 0n ? remaining : 0n;

    return { practiceId, periodMonth, tier: practice.tier, amountDueCentimes };
  }
}

// periodMonth au format "YYYY-MM" — bornes UTC [start, end).
function resolvePeriodBounds(periodMonth: string): { start: Date; end: Date } {
  const [year, month] = periodMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}
