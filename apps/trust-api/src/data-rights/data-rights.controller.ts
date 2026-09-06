import { Body, Controller, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { Roles } from "../common/rbac/roles.decorator";
import { CurrentOrganizationId } from "../common/rbac/current-organization-id.decorator";
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
    @CurrentOrganizationId() organizationId: string,
  ) {
    // Cette route n'a pas de params.id : RolesGuard résout l'organisation depuis
    // le CORPS, donc organizationId et dto.organizationId coïncident. On transmet
    // celle que le guard a effectivement AUTORISÉE, jamais celle qu'il a lue.
    return this.dataRights.exportSubjectData({
      phone: dto.phone,
      organizationId,
      requestedByUserId: user.id,
    });
  }

  // `:id` = id du client. Sous-chemin `customers/data-rights/:id/anonymize`
  // (aucune collision avec `customers/:id/…` de CustomersController).
  // @OrganizationIdSource("customer") : RolesGuard résout l'organisation depuis
  // params.id et vérifie que l'appelant en est owner/admin.
  @Post(":id/anonymize")
  @Roles("owner", "admin")
  @OrganizationIdSource("customer")
  anonymize(
    @Param("id") id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrganizationId() organizationId: string,
  ) {
    return this.dataRights.anonymizeCustomerById(
      id,
      { requestedByUserId: user.id, viaOps: false },
      organizationId,
    );
  }
}
