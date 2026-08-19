import { Controller, Get, Param } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { OrganizationAccessService } from "../common/rbac/organization-access.service";
import { MarginService } from "./margin.service";

const MARGIN_ELIGIBLE_ROLES = ["owner", "admin"] as const;

// E7, ADR-084 — même style que FecController (F9) : aucun @Roles(), business_manager
// n'est jamais un OrganizationRole (mandat cabinet/CGA, Mandate.grantedRole).
// Autorisation entièrement déléguée à OrganizationAccessService.assertAccess().
@ApiTags("margin")
@ApiBearerAuth()
@Controller("organizations/:id/margin")
export class MarginController {
  constructor(
    private readonly marginService: MarginService,
    private readonly organizationAccess: OrganizationAccessService,
  ) {}

  @Get("lines")
  async listLines(@Param("id") organizationId: string, @CurrentUser() user: CurrentUserPayload) {
    await this.organizationAccess.assertAccess(organizationId, user.id, [...MARGIN_ELIGIBLE_ROLES], "business_manager");
    return this.marginService.listLines(organizationId);
  }

  @Get("by-product")
  async listByProduct(@Param("id") organizationId: string, @CurrentUser() user: CurrentUserPayload) {
    await this.organizationAccess.assertAccess(organizationId, user.id, [...MARGIN_ELIGIBLE_ROLES], "business_manager");
    return this.marginService.listByProduct(organizationId);
  }
}
