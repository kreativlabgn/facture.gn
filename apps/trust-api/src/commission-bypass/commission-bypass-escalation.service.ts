import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { CASH_PROOF_THRESHOLD_GNF_CENTIMES } from "../payments/dto/create-payment.dto";

// G3, ADR-091 — constante MVP documentée comme arbitraire (même posture que
// STRUCTURING_LOOP_MIN_OCCURRENCES, cash-anomaly-detection.ts) : la moitié du
// seuil global, calibrage réel différé aux données pilotes.
export const LOWERED_PROOF_THRESHOLD_GNF_CENTIMES = CASH_PROOF_THRESHOLD_GNF_CENTIMES / 2n;

@Injectable()
export class CommissionBypassEscalationService {
  private readonly logger = new Logger(CommissionBypassEscalationService.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // Meilleur effort, jamais bloquant (même principe que
  // PaymentsService.detectAndRecordCashAnomaly(), G1) : un bug ici ne doit jamais
  // faire échouer un encaissement déjà légitimement committé. Escalade automatique
  // strictement bornée à none→level_1→level_2 (voir PLAN "Clarifications") —
  // level_3 (revue) et level_4 (restriction) exigent une action explicite Squad
  // Money via CommissionBypassReviewService, jamais posés ici.
  async evaluateAndEscalate(organizationId: string, patterns: string[]) {
    if (patterns.length === 0) {
      return;
    }

    try {
      const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });

      if (organization.commissionBypassLevel === "none") {
        // Garde de concurrence par la clause where (même pattern que
        // financeableInvoiceWhere, K4/K5) : perdre la course signifie qu'un autre
        // paiement concurrent a déjà fait avancer le niveau — no-op silencieux,
        // jamais une erreur (contrairement à CommissionBypassReviewService, qui
        // agit au premier plan pour une action humaine explicite).
        await this.prisma.organization.updateMany({
          where: { id: organizationId, commissionBypassLevel: "none" },
          data: { commissionBypassLevel: "level_1_nudged" },
        });
      } else if (organization.commissionBypassLevel === "level_1_nudged") {
        await this.prisma.organization.updateMany({
          where: { id: organizationId, commissionBypassLevel: "level_1_nudged" },
          data: {
            commissionBypassLevel: "level_2_proof_threshold_lowered",
            commissionBypassProofThresholdOverrideGnf: LOWERED_PROOF_THRESHOLD_GNF_CENTIMES,
          },
        });
      }
      // level_2/level_3/level_4 : aucune escalade automatique au-delà.
    } catch (error) {
      this.logger.warn(
        `Escalade G3 best-effort échouée pour l'organisation ${organizationId} : ${(error as Error).message}`,
      );
    }
  }
}
