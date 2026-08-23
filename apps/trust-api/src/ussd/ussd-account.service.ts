import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { MandatesService } from "../mandates/mandates.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { SMS_PROVIDER } from "../notifications/notifications.tokens";
import type { NotificationProvider } from "../notifications/notification-provider.interface";
import { UssdAuthService } from "./ussd-auth.service";
import { VelocityTierService } from "./velocity-tier.service";
import type { VelocityTier } from "./velocity-tier";

const FREEZE_WINDOW_MS = 24 * 3600_000; // borne basse de "24-48h" (§3.3), même choix que G2
const INVITER_ROLES = new Set(["owner", "admin"]);

// Option 5 USSD (§2.5 Spec USSD) — orchestre des services déjà construits,
// aucune nouvelle règle métier propre à ce service.
@Injectable()
export class UssdAccountService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly ussdAuth: UssdAuthService,
    private readonly velocityTier: VelocityTierService,
    private readonly mandatesService: MandatesService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: NotificationProvider,
    private readonly organizationsService: OrganizationsService,
  ) {}

  // 5.1, §3.3 Spec USSD — "reset PIN déclenche une bascule 24-48h vers T0 +
  // SMS systématique". Toujours SMS ici (jamais WhatsApp/both) : "systématique"
  // dans le texte spec, indépendant du notificationChannel préféré du client
  // (concept sans rapport — celui-ci concerne les clients de la PME, pas la
  // PME elle-même).
  async changePin(userId: string, organizationId: string, newPin: string): Promise<void> {
    await this.ussdAuth.createPin(userId, newPin);
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { paymentsFrozenUntil: new Date(Date.now() + FREEZE_WINDOW_MS) },
    });

    const phone = await this.prisma.userPhone.findFirst({ where: { userId } });
    if (phone) {
      await this.smsProvider.send(phone.msisdn, "Votre PIN facture.gn a été changé. Si ce n'est pas vous, contactez le support.");
    }
  }

  async getTierSummary(organizationId: string): Promise<VelocityTier> {
    return this.velocityTier.resolveTier(organizationId);
  }

  async listPendingMandates(organizationId: string) {
    return this.mandatesService.listPendingForOrganization(organizationId);
  }

  async listActiveMandates(organizationId: string) {
    return this.mandatesService.listActiveForOrganization(organizationId);
  }

  async acceptMandate(organizationId: string, mandateId: string, actorUserId: string) {
    return this.mandatesService.accept(organizationId, mandateId, actorUserId);
  }

  async revokeMandate(organizationId: string, mandateId: string, actorUserId: string) {
    return this.mandatesService.revokeAsOrganization(organizationId, mandateId, actorUserId);
  }

  // F3, DAT §3.5 (5.5) — délègue à OrganizationsService.inviteMember() (F14/H1,
  // même mécanisme que la PWA), mais ce chemin USSD ne passe jamais par
  // RolesGuard/@Roles("owner","admin") (réservé aux contrôleurs HTTP) : la
  // vérification du rôle du demandeur doit donc être refaite ici, en ligne
  // (même précédent que PracticesService.inviteMember(), F8, qui vérifie
  // requesterMembership.role lui-même pour la même raison structurelle).
  async inviteViewer(organizationId: string, requesterUserId: string, msisdn: string) {
    const requesterMembership = await this.prisma.organizationMember.findFirst({
      where: { organizationId, userId: requesterUserId, revokedAt: null },
    });
    if (!requesterMembership || !INVITER_ROLES.has(requesterMembership.role)) {
      throw new ForbiddenException("Seul le propriétaire ou un administrateur peut inviter un proche");
    }

    return this.organizationsService.inviteMember(organizationId, { msisdn, role: "viewer" }, requesterUserId);
  }
}
