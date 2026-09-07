import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";

// RLS (ADR-111 étape 1) — CARTE DU SERVICE. `commission_bypass_case` et
// `organization` sont toutes deux sous org_isolation.
//
// L'acteur des deux méthodes est la Squad Money (outil interne, clé dédiée
// COMMISSION_BYPASS_REVIEW_INTERNAL_KEY) : les deux contrôleurs sont @Public()
// sans @Roles(), donc RolesGuard ne résout AUCUNE organisation et
// @CurrentOrganizationId() y lèverait. Comme pour le portail acheteur public, le
// GUC posé ici est DESCRIPTIF (« cette ligne appartient à l'organisation X »),
// jamais autorisant — l'autorisation vient entièrement du garde à clé interne.
//
// openCase() reçoit l'organisation dans son URL ; resolveCase() ne connaît que
// l'id du case et DÉCOUVRE l'organisation à partir de lui — cette lecture-là
// reste donc globale, par nécessité.
@Injectable()
export class CommissionBypassReviewService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // G3, ADR-091 — Niveau 3, action explicite Squad Money, jamais automatique
  // (voir PLAN "Clarifications"). N'accepte l'ouverture que depuis level_2 :
  // une organisation qui n'a pas déjà traversé l'escalade automatique n'a rien
  // à faire examiner manuellement.
  async openCase(organizationId: string, detectedPatterns: string[]) {
    const existingPending = await organizationScopedClient(this.prisma, organizationId).commissionBypassCase.findFirst({
      where: { organizationId, status: "pending" },
    });
    if (existingPending) {
      throw new ConflictException(`Organisation ${organizationId} a déjà un case de revue en attente`);
    }

    return this.prisma.$transaction(async (tx) => {
      // GUC en première ligne : il couvre la revendication du niveau et la
      // création du case.
      await setOrganizationScope(tx, organizationId);

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
  async resolveCase(caseId: string, decision: "dismiss" | "restrict", operatorId: string) {
    // Lecture de DÉCOUVERTE, non scopée à dessein : l'organisation du case sort
    // de cette ligne. findFirst nullable plutôt que findUniqueOrThrow : cette
    // application n'a AUCUN ExceptionFilter, donc un caseId inconnu remontait en
    // 500. L'enjeu n'est pas ici l'énumération — l'appelant est la Squad Money,
    // authentifiée par clé interne — mais la qualité de la réponse rendue à un
    // outil d'exploitation : un 404 explicite, jamais une erreur serveur opaque.
    const bypassCase = await this.prisma.commissionBypassCase.findFirst({ where: { id: caseId } });
    if (!bypassCase) {
      throw new NotFoundException(`Case de revue ${caseId} introuvable`);
    }
    const resolvedAt = new Date();
    const status = decision === "dismiss" ? "dismissed" : "restricted";

    return this.prisma.$transaction(async (tx) => {
      // GUC posé sur l'organisation DÉCOUVERTE ci-dessus : il couvre la
      // résolution du case et la mise à jour du niveau de l'organisation.
      await setOrganizationScope(tx, bypassCase.organizationId);

      const claimed = await tx.commissionBypassCase.updateMany({
        where: { id: caseId, organizationId: bypassCase.organizationId, status: "pending" },
        data: { status, resolvedAt, resolvedByOperatorId: operatorId },
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

      return { ...bypassCase, status, resolvedAt, resolvedByOperatorId: operatorId };
    });
  }
}
