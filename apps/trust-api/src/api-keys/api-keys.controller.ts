import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { createApiKeySchema, type CreateApiKeyDto } from "./dto/create-api-key.dto";
import { ApiKeysService } from "./api-keys.service";

// F15, ADR-097 — imbriqué sous /organizations/:id (comme /organizations/:id/fec,
// /organizations/:id/audit-log) plutôt que les routes plates de l'openapi
// (/api-keys) : aucune "organisation active" n'existe dans le JWT pour les
// résoudre sans paramètre explicite (voir PLAN "Clarifications").
@ApiTags("api-keys")
@ApiBearerAuth()
@Controller("organizations/:id/api-keys")
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @Roles("owner", "admin", "developer_api")
  @OrganizationIdSource("organization")
  create(
    @Param("id") organizationId: string,
    @Body(new ZodValidationPipe(createApiKeySchema)) dto: CreateApiKeyDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.apiKeysService.createApiKey(organizationId, dto.environment, user.id);
  }

  @Get()
  @Roles("owner", "admin", "developer_api")
  @OrganizationIdSource("organization")
  list(@Param("id") organizationId: string) {
    return this.apiKeysService.listApiKeys(organizationId);
  }

  // Aucun @Delete() dans ce repo (vérifié) : convention 100% POST pour toute
  // action de résolution/révocation, même style que resolveCreditLimitRequest()
  // (E5) et resolveRecovery(). Jamais d'idSource "api-key" dédié : :id EST déjà
  // l'organisation ici (contrairement à E5 où :id était l'id de la demande) —
  // ApiKeysService.revokeApiKey() vérifie explicitement que apiKeyId appartient
  // à cette organisation, jamais une confiance aveugle.
  @Post(":apiKeyId/revoke")
  @Roles("owner", "admin", "developer_api")
  @OrganizationIdSource("organization")
  revoke(
    @Param("id") organizationId: string,
    @Param("apiKeyId") apiKeyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.apiKeysService.revokeApiKey(organizationId, apiKeyId, user.id);
  }
}
