import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { DgiVerificationAuthGuard } from "../common/dgi-verification-auth.guard";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { createOrganizationSchema, type CreateOrganizationDto } from "./dto/create-organization.dto";
import {
  createAssistedOrganizationSchema,
  type CreateAssistedOrganizationDto,
} from "./dto/create-assisted-organization.dto";
import { auditLogQuerySchema, type AuditLogQueryDto } from "./dto/audit-log-query.dto";
import {
  inviteOrganizationMemberSchema,
  type InviteOrganizationMemberDto,
} from "./dto/invite-organization-member.dto";
import {
  upgradeCommercialTierSchema,
  type UpgradeCommercialTierDto,
} from "./dto/upgrade-commercial-tier.dto";
import { OrganizationsService } from "./organizations.service";

@ApiTags("organizations")
@ApiBearerAuth()
@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  // Aucun rôle requis à la création : n'importe quel utilisateur authentifié peut
  // créer une organisation, il en devient automatiquement owner (voir service).
  // Pipe scopé au paramètre @Body() — un @UsePipes() au niveau méthode s'appliquerait
  // aussi à @CurrentUser(), qui échouerait alors le même schéma de validation.
  @Post()
  create(
    @Body(new ZodValidationPipe(createOrganizationSchema)) dto: CreateOrganizationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.organizationsService.create(dto, user.id);
  }

  // Appel machine-à-machine exclusif (B2) — "en tant que système" dans le backlog,
  // jamais un rôle humain organisationnel : @Public() court-circuite JwtAuthGuard,
  // RolesGuard est un no-op sans @Roles(), DgiVerificationAuthGuard est le seul
  // vrai garde. Une organisation ne peut jamais déclencher sa propre vérification.
  @Post(":id/verify-dgi")
  @Public()
  @ApiSecurity("internal-api-key")
  @UseGuards(DgiVerificationAuthGuard)
  verifyDgi(@Param("id") organizationId: string) {
    return this.organizationsService.verifyDgi(organizationId);
  }

  // JWT requis (B5, ADR-107) — jamais @Public() : l'appelant doit être authentifié
  // comme l'Agent commercial terrain lui-même (pas de CommercialAgentAuthGuard ici,
  // contrairement à /auth/commercial-agents/:userId/grant qui est un octroi
  // machine-à-machine ponctuel). Aucun @Roles() : isCommercialAgent n'est pas un
  // OrganizationRole, la garde vit dans le service (relit isCommercialAgent depuis
  // la DB, jamais fait confiance au client).
  @Post("assisted")
  createAssisted(
    @Body(new ZodValidationPipe(createAssistedOrganizationSchema)) dto: CreateAssistedOrganizationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.organizationsService.createAssisted(user.id, dto);
  }

  // E8, ADR-093 — strictement informatif, interne à l'organisation (owner/admin
  // uniquement, backlog explicite) : jamais un gate de fonctionnalité, jamais
  // exposé à un tiers externe au MVP. @OrganizationIdSource("organization") :
  // :id est ici directement l'organisation, pas une facture qui lui appartient
  // (RolesGuard résout "invoice" par défaut pour toutes les autres routes).
  @Get(":id/trust-score")
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  getTrustScore(@Param("id") organizationId: string) {
    return this.organizationsService.getVerifiedPaymentRatio(organizationId);
  }

  // Point d'entrée manquant jusqu'ici : après login, rien ne permettait à un
  // client de découvrir à quelle(s) organisation(s) l'utilisateur appartient
  // (CurrentUser ne porte que { id }). Aucun @Roles() : il n'y a pas encore
  // d'organisation ciblée à ce stade, le filtrage se fait entièrement dans le
  // service à partir de user.id — JwtAuthGuard suffit (même principe que
  // PracticesController.findAllByType()).
  @Get()
  listMine(@CurrentUser() user: CurrentUserPayload) {
    return this.organizationsService.listMine(user.id);
  }

  // Détail organisation (paramètres) — même trio owner/admin que trust-score
  // ci-dessus, sensibilité de champs comparable.
  @Get(":id")
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  findOne(@Param("id") organizationId: string) {
    return this.organizationsService.findOneDetail(organizationId);
  }

  // G4, ADR-097 — lecture seule stricte, aucune exception : auditor s'ajoute au
  // trio owner/admin déjà présent sur trust-score/findOne (mêmes routes de lecture
  // organisationnelle), jamais sur une route d'écriture.
  @Get(":id/audit-log")
  @Roles("owner", "admin", "auditor")
  @OrganizationIdSource("organization")
  listAuditLog(
    @Param("id") organizationId: string,
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQueryDto,
  ) {
    return this.organizationsService.listAuditLog(organizationId, query);
  }

  // F14, ADR-104 — même trio owner/admin que findOne()/trust-score ci-dessus
  // (élévation de privilège : seul owner/admin peut donner accès à un tiers).
  @Post(":id/members")
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  inviteMember(
    @Param("id") organizationId: string,
    @Body(new ZodValidationPipe(inviteOrganizationMemberSchema)) dto: InviteOrganizationMemberDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.organizationsService.inviteMember(organizationId, dto, user.id);
  }

  // H2, ADR-049 — même trio owner/admin que les autres routes de gestion
  // d'organisation ci-dessus. Jamais de DgiVerificationAuthGuard ici (voir
  // service) : le palier commercial n'est jamais dépendant de DGI.
  @Post(":id/commercial-tier")
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  upgradeCommercialTier(
    @Param("id") organizationId: string,
    @Body(new ZodValidationPipe(upgradeCommercialTierSchema)) dto: UpgradeCommercialTierDto,
  ) {
    return this.organizationsService.upgradeCommercialTier(organizationId, dto.tier);
  }

  // A4, ADR-025 — self-service owner/admin, jamais un workflow d'approbation
  // (une clé compromise doit pouvoir être révoquée immédiatement).
  @Post(":id/signing-key/revoke")
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  revokeSigningKey(@Param("id") organizationId: string) {
    return this.organizationsService.revokeSigningKey(organizationId);
  }

  // Security Audit 2026-08-23, finding #8 — même trio owner/admin et même posture
  // self-service que revokeSigningKey() ci-dessus.
  @Post(":id/assisted-sessions/:agentUserId/revoke")
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  revokeAssistedSession(@Param("id") organizationId: string, @Param("agentUserId") agentUserId: string) {
    return this.organizationsService.revokeAssistedSession(organizationId, agentUserId);
  }
}
