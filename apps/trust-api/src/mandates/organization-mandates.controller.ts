import { Controller, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
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
}
