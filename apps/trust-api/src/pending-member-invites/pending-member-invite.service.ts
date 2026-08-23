import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { OrganizationRole, PracticeMemberRole, Prisma, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { assertPracticeAdmin } from "../common/rbac/practice-access";
import { isRoleAllowedForTier, maxMembersForTier } from "../common/plan-features-grid";
import type { NotificationProvider } from "../notifications/notification-provider.interface";
import { SMS_PROVIDER } from "../notifications/notifications.tokens";
import type { InviteOrganizationPendingDto } from "./dto/invite-organization-pending.dto";
import type { InvitePracticePendingDto } from "./dto/invite-practice-pending.dto";

// F10 — TTL arbitraire (aucune spec ne fixe de durée), plus court que les 90
// jours d'AssistedSession car une invitation de collaborateur non répondue
// perd rapidement sa pertinence. Ajustable en un point unique.
export const PENDING_MEMBER_INVITE_TTL_MS = 14 * 24 * 60 * 60_000;

function pendingInviteNotExpiredWhere(): Prisma.PendingMemberInviteWhereInput {
  return { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } };
}

@Injectable()
export class PendingMemberInviteService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(SMS_PROVIDER) private readonly smsProvider: NotificationProvider,
  ) {}

  // RolesGuard (@Roles("owner","admin") sur la route) garantit déjà que
  // l'appelant est owner ou admin — même garde de base que
  // OrganizationsService.inviteMember(). Security Audit 2026-08-23, finding
  // #12 — restriction supplémentaire répliquée ici (chemin d'invitation
  // distinct, pas un fallback interne à inviteMember()) : seul le owner peut
  // inviter un pair admin ou approver.
  async inviteToOrganization(
    organizationId: string,
    dto: InviteOrganizationPendingDto,
    requesterUserId: string,
  ): Promise<{ id: string }> {
    if (dto.role === "admin" || dto.role === "approver") {
      const requesterMembership = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: requesterUserId } },
      });
      if (requesterMembership?.role !== "owner") {
        throw new ForbiddenException(`Seul le owner peut inviter un membre avec le rôle ${dto.role}`);
      }
    }

    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (!isRoleAllowedForTier(dto.role as OrganizationRole, organization.commercialTier)) {
      throw new ForbiddenException(
        `Le rôle ${dto.role} nécessite un palier commercial supérieur à ${organization.commercialTier}`,
      );
    }
    const maxMembers = maxMembersForTier(organization.commercialTier);
    if (maxMembers !== null) {
      const activeMemberCount = await this.prisma.organizationMember.count({
        where: { organizationId, revokedAt: null },
      });
      if (activeMemberCount >= maxMembers) {
        throw new ForbiddenException(
          `Palier ${organization.commercialTier} limité à ${maxMembers} collaborateur(s) — upgrade requis`,
        );
      }
    }

    const existingPhone = await this.prisma.userPhone.findUnique({ where: { msisdn: dto.msisdn } });
    if (existingPhone) {
      throw new ConflictException(
        `Un compte existe déjà pour le numéro ${dto.msisdn} — utiliser l'invitation directe (POST .../members)`,
      );
    }

    const existingPending = await this.prisma.pendingMemberInvite.findFirst({
      where: { msisdn: dto.msisdn, organizationId, ...pendingInviteNotExpiredWhere() },
    });
    if (existingPending) {
      throw new ConflictException(`Une invitation est déjà en attente pour le numéro ${dto.msisdn}`);
    }

    const invite = await this.prisma.pendingMemberInvite.create({
      data: {
        msisdn: dto.msisdn,
        role: dto.role,
        organizationId,
        invitedByUserId: requesterUserId,
        expiresAt: new Date(Date.now() + PENDING_MEMBER_INVITE_TTL_MS),
      },
    });

    await this.notifyInvitee(dto.msisdn, organization.name);

    return { id: invite.id };
  }

  async inviteToPractice(
    practiceId: string,
    dto: InvitePracticePendingDto,
    requesterUserId: string,
  ): Promise<{ id: string }> {
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId, "inviter un collaborateur");

    const existingPhone = await this.prisma.userPhone.findUnique({ where: { msisdn: dto.msisdn } });
    if (existingPhone) {
      throw new ConflictException(
        `Un compte existe déjà pour le numéro ${dto.msisdn} — utiliser l'invitation directe (POST .../members)`,
      );
    }

    const existingPending = await this.prisma.pendingMemberInvite.findFirst({
      where: { msisdn: dto.msisdn, practiceId, ...pendingInviteNotExpiredWhere() },
    });
    if (existingPending) {
      throw new ConflictException(`Une invitation est déjà en attente pour le numéro ${dto.msisdn}`);
    }

    const practice = await this.prisma.professionalPractice.findUniqueOrThrow({ where: { id: practiceId } });

    const invite = await this.prisma.pendingMemberInvite.create({
      data: {
        msisdn: dto.msisdn,
        role: dto.role,
        practiceId,
        invitedByUserId: requesterUserId,
        expiresAt: new Date(Date.now() + PENDING_MEMBER_INVITE_TTL_MS),
      },
    });

    await this.notifyInvitee(dto.msisdn, practice.name);

    return { id: invite.id };
  }

  // Appelé dans la même transaction que la création d'un User+UserPhone tout
  // neuf (AuthService.register, OrganizationsService.createAssisted,
  // ClientPortalAuthService) — jamais isolé, pour qu'une résolution partielle
  // (user créé mais invitation non résolue) ne puisse jamais survivre à un
  // rollback. Résout TOUTES les invitations en attente pour ce numéro (une
  // même personne peut être invitée par plusieurs organisations/cabinets).
  async resolveForNewUser(tx: Prisma.TransactionClient, userId: string, msisdn: string): Promise<void> {
    const pendingInvites = await tx.pendingMemberInvite.findMany({
      where: { msisdn, ...pendingInviteNotExpiredWhere() },
    });

    for (const invite of pendingInvites) {
      if (invite.organizationId) {
        await tx.organizationMember.create({
          data: { organizationId: invite.organizationId, userId, role: invite.role as OrganizationRole },
        });
      } else if (invite.practiceId) {
        await tx.practiceMember.create({
          data: { practiceId: invite.practiceId, userId, role: invite.role as PracticeMemberRole },
        });
      }

      await tx.pendingMemberInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date(), resolvedUserId: userId },
      });
    }
  }

  // RolesGuard (@Roles("owner","admin")) garde déjà l'accès à cette méthode.
  async revokeForOrganization(organizationId: string, inviteId: string): Promise<void> {
    // updateMany+where (jamais update inconditionnel) — même garde que
    // OrganizationsService.revokeAssistedSession() : une révocation concurrente
    // ou une invitation déjà résolue/expirée ne doit jamais réémettre un
    // revokedAt "gagnant" trompeur.
    const claimed = await this.prisma.pendingMemberInvite.updateMany({
      where: { id: inviteId, organizationId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new NotFoundException(`Aucune invitation en attente ${inviteId} pour l'organisation ${organizationId}`);
    }
  }

  async revokeForPractice(practiceId: string, inviteId: string, requesterUserId: string): Promise<void> {
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId, "révoquer une invitation");

    const claimed = await this.prisma.pendingMemberInvite.updateMany({
      where: { id: inviteId, practiceId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new NotFoundException(`Aucune invitation en attente ${inviteId} pour la practice ${practiceId}`);
    }
  }

  // RolesGuard (@Roles("owner","admin")) garde déjà l'accès à cette méthode.
  async listPendingForOrganization(organizationId: string) {
    return this.prisma.pendingMemberInvite.findMany({
      where: { organizationId, ...pendingInviteNotExpiredWhere() },
      orderBy: { createdAt: "desc" },
    });
  }

  async listPendingForPractice(practiceId: string, requesterUserId: string) {
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId, "consulter les invitations en attente");

    return this.prisma.pendingMemberInvite.findMany({
      where: { practiceId, ...pendingInviteNotExpiredWhere() },
      orderBy: { createdAt: "desc" },
    });
  }

  // Best-effort — même garantie que PaymentReminderService.send()/
  // PaymentLinkNotificationService.notify() : ne lève jamais, la création de
  // l'invitation reste considérée réussie même si l'envoi effectif échoue.
  private async notifyInvitee(msisdn: string, inviterName: string): Promise<void> {
    try {
      await this.smsProvider.send(
        msisdn,
        `${inviterName} vous invite à rejoindre facture.gn. Inscrivez-vous sur facture.gn pour accéder à votre espace.`,
      );
    } catch {
      // best-effort, jamais couplé à la réussite de la création de l'invitation.
    }
  }
}
