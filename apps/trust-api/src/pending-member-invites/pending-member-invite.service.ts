import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { OrganizationRole, PracticeMemberRole, Prisma, PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, practiceScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { assertPracticeAdmin } from "../common/rbac/practice-access";
import { isRoleAllowedForTier, maxMembersForTier } from "../common/plan-features-grid";
import { type Locale, resolveLocale, t } from "../i18n";
import type { NotificationProvider } from "../notifications/notification-provider.interface";
import { SMS_PROVIDER } from "../notifications/notifications.tokens";
import type { InviteOrganizationPendingDto } from "./dto/invite-organization-pending.dto";
import type { InvitePracticePendingDto } from "./dto/invite-practice-pending.dto";

// F10, revue post-fix #1 — cette table n'a qu'une seule paire de contraintes
// uniques possible à chaque point d'écriture ci-dessous (index partiels
// pending_member_invite_one_live_per_org/_practice, 20260823160000) : catch
// générique (pas isUniqueConstraintViolation, qui suppose un mapping de champ
// que Prisma ne peut pas établir pour un index créé hors schéma) — même
// précédent que OrganizationsService.inviteMember() (organizations.service.ts).
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

// F10 — TTL arbitraire (aucune spec ne fixe de durée), plus court que les 90
// jours d'AssistedSession car une invitation de collaborateur non répondue
// perd rapidement sa pertinence. Ajustable en un point unique.
export const PENDING_MEMBER_INVITE_TTL_MS = 14 * 24 * 60 * 60_000;

function pendingInviteNotExpiredWhere(): Prisma.PendingMemberInviteWhereInput {
  return { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } };
}

// RLS (ADR-111 étape 1) — CARTE DU MODULE. `pending_member_invite` est sous
// politique org_isolation en XOR : elle porte organization_id OU practice_id,
// et le prédicat teste les DEUX GUC. Ce service a donc, comme mandates, deux
// scopes selon l'acteur — organisation pour le chemin PME, cabinet pour le
// chemin practice. Jamais les deux GUC sur une même requête.
//
// Restent GLOBAUX, à dessein :
//   • `user_phone` : hors RLS. Le contrôle « ce numéro a-t-il DÉJÀ un compte »
//     est une question d'annuaire GLOBAL — scopé, il serait aveugle aux comptes
//     des autres organisations et laisserait créer une invitation en doublon.
//   • `practice_member` (via assertPracticeAdmin) et `professional_practice` :
//     hors RLS, annuaire cabinet partagé.
//   • resolveForNewUser() en entier : voir son commentaire — c'est la méthode
//     qui doit voir les invitations de TOUTES les organisations et cabinets.
//
// Aucune transaction propre à ce module : la seule dans laquelle il s'exécute
// est celle de son APPELANT (register/createAssisted/portail client), qui la
// laisse volontairement sans GUC. Aucun setOrganizationScope() à poser ici.
@Injectable()
export class PendingMemberInviteService {
  private readonly logger = new Logger(PendingMemberInviteService.name);

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
    const scoped = organizationScopedClient(this.prisma, organizationId);

    if (dto.role === "admin" || dto.role === "approver") {
      const requesterMembership = await scoped.organizationMember.findFirst({
        where: { organizationId, userId: requesterUserId },
      });
      if (requesterMembership?.role !== "owner") {
        throw new ForbiddenException(`Seul le owner peut inviter un membre avec le rôle ${dto.role}`);
      }
    }

    // Pas d'oracle 500 ici malgré le *OrThrow : la route est imbriquée sous
    // /organizations/:id avec @OrganizationIdSource("organization"), donc
    // RolesGuard a DÉJÀ résolu cette organisation (findUnique + 404 explicite)
    // avant d'entrer dans le service — un id inconnu n'atteint jamais ce point.
    const organization = await scoped.organization.findFirstOrThrow({ where: { id: organizationId } });
    if (!isRoleAllowedForTier(dto.role as OrganizationRole, organization.commercialTier)) {
      throw new ForbiddenException(
        `Le rôle ${dto.role} nécessite un palier commercial supérieur à ${organization.commercialTier}`,
      );
    }
    const maxMembers = maxMembersForTier(organization.commercialTier);
    if (maxMembers !== null) {
      const activeMemberCount = await scoped.organizationMember.count({
        where: { organizationId, revokedAt: null },
      });
      // F10, revue post-fix #4 — le quota ne comptait auparavant que les
      // membres déjà actifs, jamais les invitations en attente : un owner
      // pouvait empiler plus d'invitations que de places réellement libres
      // (aucune des invitations en cours n'incrémente le compte actif tant
      // qu'elle n'est pas résolue), dépassant durablement le quota du palier
      // si plusieurs invités s'inscrivent ensuite.
      const pendingInviteCount = await scoped.pendingMemberInvite.count({
        where: { organizationId, ...pendingInviteNotExpiredWhere() },
      });
      if (activeMemberCount + pendingInviteCount >= maxMembers) {
        throw new ForbiddenException(
          `Palier ${organization.commercialTier} limité à ${maxMembers} collaborateur(s) — upgrade requis`,
        );
      }
    }

    // Annuaire GLOBAL, non scopé à dessein : la question est « ce numéro a-t-il
    // un compte facture.gn », pas « dans cette organisation ». user_phone est
    // hors RLS de toute façon.
    const existingPhone = await this.prisma.userPhone.findUnique({ where: { msisdn: dto.msisdn } });
    if (existingPhone) {
      throw new ConflictException(
        `Un compte existe déjà pour le numéro ${dto.msisdn} — utiliser l'invitation directe (POST .../members)`,
      );
    }

    const existingPending = await scoped.pendingMemberInvite.findFirst({
      where: { msisdn: dto.msisdn, organizationId, ...pendingInviteNotExpiredWhere() },
    });
    if (existingPending) {
      throw new ConflictException(`Une invitation est déjà en attente pour le numéro ${dto.msisdn}`);
    }

    // F10, revue post-fix #1 — le findFirst ci-dessus ne protège pas contre
    // deux invitations concurrentes du même numéro (fenêtre de course entre la
    // lecture et l'écriture) : l'index unique partiel
    // pending_member_invite_one_live_per_org (20260823160000) reste le seul
    // garde-fou réel sous concurrence.
    let invite;
    try {
      invite = await scoped.pendingMemberInvite.create({
        data: {
          msisdn: dto.msisdn,
          role: dto.role,
          organizationId,
          invitedByUserId: requesterUserId,
          expiresAt: new Date(Date.now() + PENDING_MEMBER_INVITE_TTL_MS),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`Une invitation est déjà en attente pour le numéro ${dto.msisdn}`);
      }
      throw error;
    }

    await this.notifyInvitee(dto.msisdn, organization.name, resolveLocale(organization.preferredLanguage));

    return { id: invite.id };
  }

  async inviteToPractice(
    practiceId: string,
    dto: InvitePracticePendingDto,
    requesterUserId: string,
  ): Promise<{ id: string }> {
    // practice_member est hors RLS (annuaire cabinet partagé) : cette garde
    // reste sur le client global, à dessein.
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId, "inviter un collaborateur");

    const scoped = practiceScopedClient(this.prisma, practiceId);

    // Annuaire GLOBAL, même raison que dans inviteToOrganization().
    const existingPhone = await this.prisma.userPhone.findUnique({ where: { msisdn: dto.msisdn } });
    if (existingPhone) {
      throw new ConflictException(
        `Un compte existe déjà pour le numéro ${dto.msisdn} — utiliser l'invitation directe (POST .../members)`,
      );
    }

    const existingPending = await scoped.pendingMemberInvite.findFirst({
      where: { msisdn: dto.msisdn, practiceId, ...pendingInviteNotExpiredWhere() },
    });
    if (existingPending) {
      throw new ConflictException(`Une invitation est déjà en attente pour le numéro ${dto.msisdn}`);
    }

    // professional_practice est hors RLS. Pas d'oracle 500 malgré le *OrThrow :
    // assertPracticeAdmin() ci-dessus lève déjà ForbiddenException pour un
    // practiceId inconnu (aucune appartenance ne peut exister) — cette ligne
    // n'est jamais atteinte avec un identifiant qui n'existe pas.
    const practice = await this.prisma.professionalPractice.findUniqueOrThrow({ where: { id: practiceId } });

    // F10, revue post-fix #1 — même garde que inviteToOrganization : l'index
    // unique partiel pending_member_invite_one_live_per_practice
    // (20260823160000) reste le seul garde-fou réel sous concurrence.
    let invite;
    try {
      invite = await scoped.pendingMemberInvite.create({
        data: {
          msisdn: dto.msisdn,
          role: dto.role,
          practiceId,
          invitedByUserId: requesterUserId,
          expiresAt: new Date(Date.now() + PENDING_MEMBER_INVITE_TTL_MS),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`Une invitation est déjà en attente pour le numéro ${dto.msisdn}`);
      }
      throw error;
    }

    await this.notifyInvitee(dto.msisdn, practice.name);

    return { id: invite.id };
  }

  // Appelé dans la même transaction que la création d'un User+UserPhone tout
  // neuf (AuthService.register, OrganizationsService.createAssisted,
  // ClientPortalAuthService) — jamais isolé, pour qu'une résolution partielle
  // (user créé mais invitation non résolue) ne puisse jamais survivre à un
  // rollback. Résout TOUTES les invitations en attente pour ce numéro (une
  // même personne peut être invitée par plusieurs organisations/cabinets).
  //
  // RLS — À NE JAMAIS SCOPER, et c'est la raison d'être de la méthode : elle
  // résout les invitations de TOUTES les organisations et de TOUS les cabinets
  // ayant invité ce numéro. Poser un GUC (org ou practice) sur la transaction de
  // l'appelant n'en laisserait voir qu'une seule et ferait échouer silencieusement
  // les autres. C'est exactement ce qui est documenté côté appelants —
  // AuthService.register() et OrganizationsService.createAssisted() gardent leurs
  // transactions sans GUC pour cette raison précise.
  async resolveForNewUser(tx: Prisma.TransactionClient, userId: string, msisdn: string): Promise<void> {
    const pendingInvites = await tx.pendingMemberInvite.findMany({
      where: { msisdn, ...pendingInviteNotExpiredWhere() },
    });

    for (const invite of pendingInvites) {
      // F10, revue post-fix #3 — claim AVANT de créer le membership (pas
      // après, contrairement à la version initiale) : updateMany+where
      // (acceptedAt/revokedAt encore null), même garde que
      // revokeForOrganization/revokeForPractice dans ce même fichier. Une
      // invitation révoquée entre le findMany ci-dessus et cet instant
      // (fenêtre de course réelle, isolation Read Committed) ne doit jamais
      // produire de membership — sans ce claim, l'ordre inverse (créer le
      // membership puis marquer l'invitation acceptée) pouvait accorder un
      // accès à une invitation déjà révoquée.
      const claimed = await tx.pendingMemberInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date(), resolvedUserId: userId },
      });
      if (claimed.count === 0) {
        continue;
      }

      try {
        if (invite.organizationId) {
          await tx.organizationMember.create({
            data: { organizationId: invite.organizationId, userId, role: invite.role as OrganizationRole },
          });
        } else if (invite.practiceId) {
          await tx.practiceMember.create({
            data: { practiceId: invite.practiceId, userId, role: invite.role as PracticeMemberRole },
          });
        } else {
          // Fix minor-followups 2026-08-24, revue post-fix #1 — organizationId
          // ET practiceId peuvent désormais être tous les deux null : la cible
          // de l'invitation (organisation ou cabinet) a été supprimée après
          // coup (ON DELETE SET NULL, 20260824100000 + CHECK assoupli,
          // 20260824110000). Le claim ci-dessus a déjà marqué l'invitation
          // acceptedAt/resolvedUserId — choix délibéré de la laisser ainsi
          // (jamais "acceptée à tort" : elle ne PEUT plus produire de
          // membership puisque sa cible n'existe plus, donc rien à révoquer
          // non plus) plutôt que de la laisser indéfiniment en attente pour un
          // nouvel utilisateur qui ne pourra jamais la voir résolue. Log
          // uniquement pour la visibilité opérationnelle — aucun membership
          // créé, aucune erreur levée (ne doit jamais faire échouer
          // AuthService.register()).
          this.logger.warn(
            `PendingMemberInvite ${invite.id} résolue sans cible : organisation/cabinet supprimé(e) entre l'envoi de l'invitation et l'inscription — aucun membership créé.`,
          );
        }
      } catch (error) {
        // F10, revue post-fix #1 — le claim ci-dessus garantit qu'une seule
        // invitation VIVANTE existait par (msisdn, cible) au moment de
        // l'invitation (index unique partiel, 20260823160000), mais un état
        // antérieur à cette contrainte (ou tout autre chemin résiduel) peut
        // encore produire un membership déjà existant ici : ignore cette
        // invitation spécifique (déjà satisfaite par un autre membership)
        // plutôt que de faire échouer TOUTE la transaction d'inscription
        // AuthService.register() pour un utilisateur par ailleurs innocent.
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    }
  }

  // RolesGuard (@Roles("owner","admin")) garde déjà l'accès à cette méthode.
  async revokeForOrganization(organizationId: string, inviteId: string): Promise<void> {
    // updateMany+where (jamais update inconditionnel) — même garde que
    // OrganizationsService.revokeAssistedSession() : une révocation concurrente
    // ou une invitation déjà résolue/expirée ne doit jamais réémettre un
    // revokedAt "gagnant" trompeur.
    // Aucun oracle ici : « invitation inexistante » et « invitation d'une autre
    // organisation » produisent toutes deux count===0, donc le MÊME 404. La
    // discipline était déjà en place, la double clause la renforce.
    const claimed = await organizationScopedClient(this.prisma, organizationId).pendingMemberInvite.updateMany({
      where: { id: inviteId, organizationId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new NotFoundException(`Aucune invitation en attente ${inviteId} pour l'organisation ${organizationId}`);
    }
  }

  async revokeForPractice(practiceId: string, inviteId: string, requesterUserId: string): Promise<void> {
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId, "révoquer une invitation");

    const claimed = await practiceScopedClient(this.prisma, practiceId).pendingMemberInvite.updateMany({
      where: { id: inviteId, practiceId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new NotFoundException(`Aucune invitation en attente ${inviteId} pour la practice ${practiceId}`);
    }
  }

  // RolesGuard (@Roles("owner","admin")) garde déjà l'accès à cette méthode.
  async listPendingForOrganization(organizationId: string) {
    return organizationScopedClient(this.prisma, organizationId).pendingMemberInvite.findMany({
      where: { organizationId, ...pendingInviteNotExpiredWhere() },
      orderBy: { createdAt: "desc" },
    });
  }

  async listPendingForPractice(practiceId: string, requesterUserId: string) {
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId, "consulter les invitations en attente");

    return practiceScopedClient(this.prisma, practiceId).pendingMemberInvite.findMany({
      where: { practiceId, ...pendingInviteNotExpiredWhere() },
      orderBy: { createdAt: "desc" },
    });
  }

  // Best-effort — même garantie que PaymentReminderService.send()/
  // PaymentLinkNotificationService.notify() : ne lève jamais, la création de
  // l'invitation reste considérée réussie même si l'envoi effectif échoue.
  private async notifyInvitee(msisdn: string, orgName: string, locale: Locale = "fr"): Promise<void> {
    try {
      await this.smsProvider.send(msisdn, t("notification.memberInvite", locale, { orgName }));
    } catch {
      // best-effort, jamais couplé à la réussite de la création de l'invitation.
    }
  }
}
