import { Body, Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
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
}
