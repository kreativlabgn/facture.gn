import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { MandateGrantedRole, OrganizationRole, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../prisma.module";
import { mandateNotExpiredWhere } from "./mandate-expiration";

// Généralisé depuis FecService.assertAccess() (F9) — même double chemin
// d'autorisation, désormais partagé par tout endroit qui doit laisser un
// PracticeMember (cabinet/CGA, mandat actif) accéder aux données d'une
// organisation cliente en plus de ses propres OrganizationMember.
@Injectable()
export class OrganizationAccessService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // Branche 1 (cas fréquent, une seule requête) : OrganizationMember avec un
  // rôle dans eligibleRoles. Branche 2 (seulement si la 1re échoue) : Mandate
  // actif via une practice dont l'appelant est membre actif — tout
  // PracticeMember suffit (ADR-070), pas seulement practice_admin.
  // E7, ADR-084 — requiredMandateGrantedRole optionnel : filtre le mandat sur
  // Mandate.grantedRole (ex. "business_manager", jamais un OrganizationRole).
  // Omis, comportement bit-à-bit identique à avant (FEC, F9) — tout
  // PracticeMember avec mandat actif suffit, quel que soit son grantedRole.
  async assertAccess(
    organizationId: string,
    requesterUserId: string,
    eligibleRoles: OrganizationRole[],
    requiredMandateGrantedRole?: MandateGrantedRole,
  ): Promise<void> {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: requesterUserId } },
    });
    if (member && !member.revokedAt && eligibleRoles.includes(member.role)) {
      return;
    }

    const activeMandate = await this.prisma.mandate.findFirst({
      where: {
        organizationId,
        status: "active",
        ...mandateNotExpiredWhere(),
        practice: { members: { some: { userId: requesterUserId, leftAt: null } } },
        ...(requiredMandateGrantedRole ? { grantedRole: requiredMandateGrantedRole } : {}),
      },
    });
    if (!activeMandate) {
      throw new ForbiddenException("Aucun accès à cette organisation — ni membre habilité, ni mandat actif");
    }
  }
}
