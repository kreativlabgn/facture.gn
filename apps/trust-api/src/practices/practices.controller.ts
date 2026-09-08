import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { MandatesService } from "../mandates/mandates.service";
import { createPracticeSchema, type CreatePracticeDto } from "./dto/create-practice.dto";
import { inviteMemberSchema, type InviteMemberDto } from "./dto/invite-member.dto";
import { lookupOrganizationSchema, type LookupOrganizationDto } from "./dto/lookup-organization.dto";
import {
  invitePracticePendingSchema,
  type InvitePracticePendingDto,
} from "../pending-member-invites/dto/invite-practice-pending.dto";
import { PendingMemberInviteService } from "../pending-member-invites/pending-member-invite.service";
import { upgradePartnerTierSchema, type UpgradePartnerTierDto } from "./dto/upgrade-partner-tier.dto";
import {
  upgradeRevenueShareSettlementModeSchema,
  type UpgradeRevenueShareSettlementModeDto,
} from "./dto/upgrade-revenue-share-settlement-mode.dto";
import { PracticesService } from "./practices.service";

@ApiTags("practices")
@ApiBearerAuth()
@Controller("practices")
export class PracticesController {
  constructor(
    private readonly practicesService: PracticesService,
    private readonly mandatesService: MandatesService,
    private readonly pendingMemberInviteService: PendingMemberInviteService,
  ) {}

  // GET /practices/lookup-organization?nif=… — annuaire du rattachement de
  // mandat (Chantier C). Déclarée AVANT toute route paramétrée : Nest résout
  // dans l'ordre de déclaration, et un `:id` placé plus haut capturerait
  // "lookup-organization" comme identifiant.
  //
  // Throttle à 5/min, le plus strict du dépôt (celui de /auth/login). Un
  // comptable cherche quelques clients par session ; à cette cadence, balayer
  // l'espace des NIF à 9 chiffres demanderait des siècles. Aucun @Roles() :
  // practice_admin n'est pas un OrganizationRole, l'autorisation est en ligne
  // dans le service, comme partout ailleurs dans ce contrôleur.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Get("lookup-organization")
  lookupOrganization(
    @Query(new ZodValidationPipe(lookupOrganizationSchema)) query: LookupOrganizationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.practicesService.lookupOrganizationByNif(query.nif, user.id);
  }


  // Aucun rôle requis : une practice n'est PAS scopée à une organisation existante
  // (ADR-068, entité de premier niveau parallèle) — n'importe quel utilisateur
  // authentifié peut en créer une, il en devient automatiquement practice_admin
  // (voir service). Même principe que OrganizationsController.create().
  @Post()
  create(
    @Body(new ZodValidationPipe(createPracticeSchema)) dto: CreatePracticeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.practicesService.create(dto, user.id);
  }

  // F8, ADR-068 — aucun @Roles() (practice_admin n'est pas un OrganizationRole),
  // autorisation en ligne dans le service. Pipe scopé au paramètre @Body() —
  // jamais @UsePipes() au niveau méthode ici (échouerait @CurrentUser() contre
  // le même schéma, piège documenté dans ZodValidationPipe, F2).
  @Post(":id/members")
  inviteMember(
    @Param("id") practiceId: string,
    @Body(new ZodValidationPipe(inviteMemberSchema)) dto: InviteMemberDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.practicesService.inviteMember(practiceId, dto, user.id);
  }

  // F10 — mécanisme distinct de POST :id/members ci-dessus : inviter un
  // collaborateur qui n'a PAS encore de compte facture.gn. Aucun @Roles()
  // (practice_admin n'est pas un OrganizationRole), autorisation inline dans
  // le service (assertPracticeAdmin).
  @Post(":id/pending-invites")
  invitePendingMember(
    @Param("id") practiceId: string,
    @Body(new ZodValidationPipe(invitePracticePendingSchema)) dto: InvitePracticePendingDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pendingMemberInviteService.inviteToPractice(practiceId, dto, user.id);
  }

  @Get(":id/pending-invites")
  listPendingInvites(@Param("id") practiceId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.pendingMemberInviteService.listPendingForPractice(practiceId, user.id);
  }

  @Post(":id/pending-invites/:inviteId/revoke")
  revokePendingInvite(
    @Param("id") practiceId: string,
    @Param("inviteId") inviteId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pendingMemberInviteService.revokeForPractice(practiceId, inviteId, user.id);
  }

  // F7, ADR-070 — donnée source d'un sélecteur "switch organisation" côté client
  // (PWA/dashboard) : le switch lui-même reste un problème client, aucun état
  // "organisation courante" n'est maintenu côté serveur (cohérent avec le modèle
  // stateless déjà utilisé partout dans ce repo). Tout membre actif de la
  // practice (pas seulement practice_admin) peut consulter cette liste.
  @Get(":id/organizations")
  listAccessibleOrganizations(@Param("id") practiceId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.mandatesService.listAccessibleOrganizations(practiceId, user.id);
  }

  // Départ d'un collaborateur. POST .../revoke plutôt que DELETE, même style
  // que POST :id/pending-invites/:inviteId/revoke : ce n'est pas une
  // suppression — la ligne d'appartenance reste, datée. Aucun @Roles()
  // (practice_admin n'est pas un OrganizationRole), garde en ligne.
  @Post(":id/members/:memberUserId/revoke")
  revokeMember(
    @Param("id") practiceId: string,
    @Param("memberUserId") memberUserId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.practicesService.revokeMember(practiceId, memberUserId, user.id);
  }

  // Écran "Collaborateurs" du dashboard cabinet — manquait jusqu'ici (seul
  // POST :id/members existait). Aucun @Roles() : tout membre actif suffit
  // (autorisation en ligne dans PracticesService.listMembers()).
  @Get(":id/members")
  listMembers(@Param("id") practiceId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.practicesService.listMembers(practiceId, user.id);
  }

  // Point d'entrée manquant jusqu'ici : après login, rien ne permettait de
  // découvrir à quelle(s) practice(s) l'utilisateur appartient (même gap déjà
  // comblé côté organisations, OrganizationsController.listMine()). Distinct
  // de GET /practices ci-dessous (liste TOUTES les CGA de la plateforme).
  // Aucun @Roles() : filtrage entièrement dans le service via CurrentUser.
  @Get("mine")
  listMine(@CurrentUser() user: CurrentUserPayload) {
    return this.practicesService.listMine(user.id);
  }

  // F12, ADR-078 — "liste des CGA actifs" pour le bouton « Adhérer à un CGA ».
  // "cga" hardcodé, JAMAIS un paramètre client (finding sécurité corrigé avant
  // merge, dev-security-reviewer) : accepter un type arbitraire exposerait
  // nom/téléphone/email de TOUS les cabinets comptables/gestionnaires/
  // fiduciaires à n'importe quel utilisateur authentifié, bien au-delà du scope
  // réel de cette story. Aucun autre type n'est un besoin actuel — si un jour
  // nécessaire, une route dédiée ou un allowlist explicite, jamais un passthrough.
  // Aucun @Roles() : cette liste n'est scopée à aucune organisation précise
  // (JwtAuthGuard suffit, même principe que create() ci-dessus).
  @Get()
  findAllByType() {
    return this.practicesService.findAllByType("cga");
  }

  // H3, ADR-071 — même style que POST :id/members : aucun @Roles(), garde
  // practice_admin inline dans le service.
  @Post(":id/partner-tier")
  upgradePartnerTier(
    @Param("id") practiceId: string,
    @Body(new ZodValidationPipe(upgradePartnerTierSchema)) dto: UpgradePartnerTierDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.practicesService.upgradePartnerTier(practiceId, dto.tier, user.id);
  }

  // H3, ADR-071 — même garde practice_admin, jamais rétroactif sur les
  // RevenueShareCredit déjà générés (voir service).
  @Post(":id/revenue-share-settlement-mode")
  upgradeRevenueShareSettlementMode(
    @Param("id") practiceId: string,
    @Body(new ZodValidationPipe(upgradeRevenueShareSettlementModeSchema)) dto: UpgradeRevenueShareSettlementModeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.practicesService.upgradeRevenueShareSettlementMode(practiceId, dto.mode, user.id);
  }
}
