import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";

@Injectable()
export class CommissionBypassReviewService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // G3, ADR-091 — Niveau 3, action explicite Squad Money, jamais automatique
  // (voir PLAN "Clarifications"). N'accepte l'ouverture que depuis level_2 :
  // une organisation qui n'a pas déjà traversé l'escalade automatique n'a rien
  // à faire examiner manuellement.
  async openCase(organizationId: string, detectedPatterns: string[]) {
    const existingPending = await this.prisma.commissionBypassCase.findFirst({
      where: { organizationId, status: "pending" },
    });
    if (existingPending) {
      throw new ConflictException(`Organisation ${organizationId} a déjà un case de revue en attente`);
    }

    return this.prisma.$transaction(async (tx) => {
      // Garde de concurrence par la clause where (même pattern que
      // financeableInvoiceWhere, K4/K5) : perdre la course ici est une action au
      // premier plan (Squad Money attend une réponse), jamais un no-op silencieux
      // — contrairement à CommissionBypassEscalationService (meilleur effort).
      const claimed = await tx.organization.updateMany({
        where: { id: organizationId, commissionBypassLevel: "level_2_proof_threshold_lowered" },
        data: { commissionBypassLevel: "level_3_under_review" },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          `Organisation ${organizationId} n'est pas au niveau 2 (seuil abaissé) — aucun case à ouvrir`,
        );
      }

      return tx.commissionBypassCase.create({
        data: { organizationId, status: "pending", detectedPatterns },
      });
    });
  }

  // G3, ADR-091 — dismiss : réinitialise entièrement (level→none, override
  // effacé). restrict : level_4_restricted, modélisé seulement — n'efface pas
  // l'override de seuil posé au Niveau 2 (aucune instruction contraire, et
  // level_4 n'est lu par aucun autre module ce MVP, voir gap documenté dans
  // resolveCase() ci-dessous).
  async resolveCase(caseId: string, decision: "dismiss" | "restrict") {
    const bypassCase = await this.prisma.commissionBypassCase.findUniqueOrThrow({ where: { id: caseId } });
    const resolvedAt = new Date();
    const status = decision === "dismiss" ? "dismissed" : "restricted";

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.commissionBypassCase.updateMany({
        where: { id: caseId, status: "pending" },
        data: { status, resolvedAt },
      });
      if (claimed.count === 0) {
        throw new ConflictException(`Case ${caseId} a déjà été résolu`);
      }

      if (decision === "dismiss") {
        await tx.organization.update({
          where: { id: bypassCase.organizationId },
          data: { commissionBypassLevel: "none", commissionBypassProofThresholdOverrideGnf: null },
        });
      } else {
        // Gap documenté (voir PLAN "Risques") : level_4_restricted n'est lu par
        // aucun autre module ce MVP (ni plan-features-grid.ts, ni aucun guard) —
        // état enregistré pour audit/reporting, jamais encore appliqué.
        await tx.organization.update({
          where: { id: bypassCase.organizationId },
          data: { commissionBypassLevel: "level_4_restricted" },
        });
      }

      return { ...bypassCase, status, resolvedAt };
    });
  }
}
