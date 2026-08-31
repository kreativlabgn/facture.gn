import { Body, Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { Roles } from "../common/rbac/roles.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { DataRightsService } from "./data-rights.service";
import { dataRightsExportSchema, type DataRightsExportDto } from "./dto/data-rights.dto";

// J2, ADR-116 — chemin PME (owner/admin). Sous-chemin `customers/data-rights/…`
// distinct de `customers/:id/…` (aucune collision de route avec CustomersController).
// `organizationId` vient du body : RolesGuard vérifie que l'appelant est
// owner/admin de CETTE organisation (même pattern que create()/importCustomers()),
// donc scoper l'export à cette même organisation est exactement correct.
@ApiTags("data-rights")
@ApiBearerAuth()
@Controller("customers/data-rights")
export class DataRightsController {
  constructor(private readonly dataRights: DataRightsService) {}

  @Post("export")
  @Roles("owner", "admin")
  export(
    @Body(new ZodValidationPipe(dataRightsExportSchema)) dto: DataRightsExportDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.dataRights.exportSubjectData({
      phone: dto.phone,
      organizationId: dto.organizationId,
      requestedByUserId: user.id,
    });
  }
}
