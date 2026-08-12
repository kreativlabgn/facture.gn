import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { resolveVelocityTier, VELOCITY_LIMITS_CENTIMES, type VelocityTier } from "./velocity-tier";

const DAY_MS = 24 * 3600_000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

// Factures qui comptent dans les fenêtres de vélocité — jamais draft (pas
// encore un engagement réel) ni voided (annulée, aucun effet).
const COUNTED_STATUSES = ["issued", "partially_paid", "paid"] as const;

@Injectable()
export class VelocityTierService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // 5.2 Spec USSD ("voir mon palier") — extrait pour être réutilisable en
  // dehors d'assertWithinLimits(), même calcul, aucune duplication.
  async resolveTier(organizationId: string): Promise<VelocityTier> {
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });

    const hasAnomalyFlag = organization.dgiVerifiedAt
      ? (await this.prisma.invoiceEvent.count({
          where: {
            type: "suspicious_cash_pattern_detected",
            createdAt: { gte: organization.dgiVerifiedAt },
            invoice: { organizationId },
          },
        })) > 0
      : false;

    return resolveVelocityTier({
      dgiVerificationStatus: organization.dgiVerificationStatus,
      dgiVerifiedAt: organization.dgiVerifiedAt,
      hasAnomalyFlag,
      forcedT0Until: organization.paymentsFrozenUntil,
    });
  }

  // D4, §4 Spec USSD — lève ForbiddenException si l'acte ou l'une des trois
  // fenêtres glissantes (jour/semaine/mois) dépasserait le plafond du palier
  // résolu. Appelée AVANT toute création de facture (jamais après).
  async assertWithinLimits(organizationId: string, amountCentimes: bigint): Promise<void> {
    const tier = await this.resolveTier(organizationId);
    const limits = VELOCITY_LIMITS_CENTIMES[tier];

    if (amountCentimes > limits.perAct) {
      throw new ForbiddenException(
        `Montant au-delà du plafond par acte (palier ${tier}) : ${limits.perAct / 100n} GNF`,
      );
    }

    const daySum = await this.sumIssuedSince(organizationId, DAY_MS);
    if (daySum + amountCentimes > limits.perDay) {
      throw new ForbiddenException(`Plafond journalier dépassé (palier ${tier}) : ${limits.perDay / 100n} GNF/jour`);
    }

    const weekSum = await this.sumIssuedSince(organizationId, WEEK_MS);
    if (weekSum + amountCentimes > limits.perWeek) {
      throw new ForbiddenException(
        `Plafond hebdomadaire dépassé (palier ${tier}) : ${limits.perWeek / 100n} GNF/semaine`,
      );
    }

    const monthSum = await this.sumIssuedSince(organizationId, MONTH_MS);
    if (monthSum + amountCentimes > limits.perMonth) {
      throw new ForbiddenException(`Plafond mensuel dépassé (palier ${tier}) : ${limits.perMonth / 100n} GNF/mois`);
    }
  }

  private async sumIssuedSince(organizationId: string, windowMs: number): Promise<bigint> {
    const result = await this.prisma.invoice.aggregate({
      _sum: { totalTtc: true },
      where: {
        organizationId,
        status: { in: [...COUNTED_STATUSES] },
        issuedAt: { gte: new Date(Date.now() - windowMs) },
      },
    });
    return result._sum.totalTtc ?? 0n;
  }
}
