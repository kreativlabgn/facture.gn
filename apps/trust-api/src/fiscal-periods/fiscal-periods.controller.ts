import { Controller, Get, Param, ParseIntPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { FiscalPeriodsService } from "./fiscal-periods.service";

// Lot B, ADR-110 — imbriqué sous /organizations/:id (comme /fec, /audit-log,
// /api-keys) : aucune "organisation active" dans le JWT.
@ApiTags("fiscal-periods")
@ApiBearerAuth()
@Controller("organizations/:id/fiscal-periods")
export class FiscalPeriodsController {
  constructor(private readonly fiscalPeriodsService: FiscalPeriodsService) {}

  // Clôturer un exercice = arrêté des comptes, acte de gouvernance/comptable
  // (ADR-099 : accountant_internal fait la "clôture"). IRRÉVERSIBLE — aucune
  // route de réouverture.
  @Post(":year/close")
  @Roles("owner", "admin", "accountant_internal")
  @OrganizationIdSource("organization")
  close(
    @Param("id") organizationId: string,
    @Param("year", ParseIntPipe) year: number,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.fiscalPeriodsService.close(organizationId, year, user.id);
  }

  // Lecture : + auditor (journal d'audit, G4) et tax_controller_readonly
  // (contrôleur fiscal invité, F14) — un sceau d'exercice est une pièce de
  // contrôle par nature.
  @Get()
  @Roles("owner", "admin", "accountant_internal", "auditor", "tax_controller_readonly")
  @OrganizationIdSource("organization")
  list(@Param("id") organizationId: string) {
    return this.fiscalPeriodsService.listByOrganization(organizationId);
  }
}
