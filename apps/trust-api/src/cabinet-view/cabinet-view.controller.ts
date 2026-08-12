import { Controller, Get, Param } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { OrganizationRole } from "@facture-gn/db";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { OrganizationAccessService } from "../common/rbac/organization-access.service";
import { InvoicesService } from "../invoices/invoices.service";
import { CustomersService } from "../customers/customers.service";

// Mêmes rôles éligibles que GET /invoices et GET /customers existants (aucun
// élargissement de qui, PARMI LES MEMBRES de l'organisation, peut lire) —
// seul l'ajout du chemin mandat (OrganizationAccessService) change. Routes
// distinctes de GET /invoices?organizationId=/GET /customers?organizationId=
// (gardées par RolesGuard, ignore Mandate) : même précédent que
// organizations/:id/fec à côté de /invoices (voir plan cabinet-client-organization-view).
const ELIGIBLE_ROLES: OrganizationRole[] = ["owner", "admin", "accountant_internal", "cashier", "field_agent"];

@ApiTags("cabinet-view")
@ApiBearerAuth()
@Controller("organizations/:id")
export class CabinetViewController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly customersService: CustomersService,
    private readonly organizationAccess: OrganizationAccessService,
  ) {}

  @Get("invoices")
  async listInvoices(@Param("id") organizationId: string, @CurrentUser() user: CurrentUserPayload) {
    await this.organizationAccess.assertAccess(organizationId, user.id, ELIGIBLE_ROLES);
    return this.invoicesService.findAllByOrganization(organizationId, {});
  }

  @Get("customers")
  async listCustomers(@Param("id") organizationId: string, @CurrentUser() user: CurrentUserPayload) {
    await this.organizationAccess.assertAccess(organizationId, user.id, ELIGIBLE_ROLES);
    return this.customersService.findAllByOrganization(organizationId, {});
  }
}
