import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { DgiVerificationAuthGuard } from "../common/dgi-verification-auth.guard";
import { createOrganizationSchema, type CreateOrganizationDto } from "./dto/create-organization.dto";
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
}
