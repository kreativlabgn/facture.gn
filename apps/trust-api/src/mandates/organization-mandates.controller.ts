import { Body, Controller, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { requestMandateSchema, type RequestMandateDto } from "./dto/request-mandate.dto";
import { MandatesService } from "./mandates.service";

@ApiTags("mandates")
@ApiBearerAuth()
@Controller("organizations/:id/mandates")
export class OrganizationMandatesController {
  constructor(private readonly mandatesService: MandatesService) {}

  // Réutilise intégralement le guard construit pour E8 (@OrganizationIdSource
  // "organization") — :id est ici directement l'organisation ciblée par le
  // mandat, aucune extension de RolesGuard nécessaire.
  @Post(":mandateId/accept")
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  accept(
    @Param("id") organizationId: string,
    @Param("mandateId") mandateId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.mandatesService.accept(organizationId, mandateId, user.id);
  }

  // F12, ADR-078 — "adhérer à un CGA" : sens d'initiation inverse d'accept()
  // ci-dessus. Autorisation entièrement portée par le guard (organizationId
  // résolu depuis :id) — le service ne revérifie jamais le membership.
  @Post()
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  request(
    @Param("id") organizationId: string,
    @Body(new ZodValidationPipe(requestMandateSchema)) dto: RequestMandateDto,
  ) {
    return this.mandatesService.requestFromOrganization(organizationId, dto.practiceId);
  }
}
