import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { listClientInvoicesQuerySchema, type ListClientInvoicesQueryDto } from "./dto/list-client-invoices-query.dto";
import { ClientPortalService } from "./client-portal.service";
import { ClientPortalScopeGuard } from "./client-portal-scope.guard";

// F13, ADR-096 — aucun @Roles()/@OrganizationIdSource ici, sur AUCUNE route :
// même raisonnement que PublicBuyerPortalController. client_portal n'est
// membre d'AUCUNE organisation PME — RolesGuard le rejetterait ou résoudrait
// la mauvaise identité. JwtAuthGuard (global) suffit, toute l'autorisation vit
// dans ClientPortalService (Customer.phone vs numéros vérifiés de l'appelant).
//
// Cross-Story Audit 2026-08-24, finding #1 — ClientPortalScopeGuard ajouté en
// défense explicite : seul un token scope:"client_portal" ou de portée complète
// (scope absent) accède à ces routes, jamais un futur scope plus restreint.
@ApiTags("client-portal")
@ApiBearerAuth()
@UseGuards(ClientPortalScopeGuard)
@Controller("client-portal")
export class ClientPortalController {
  constructor(private readonly clientPortalService: ClientPortalService) {}

  @Get("organizations")
  listOrganizations(@CurrentUser() user: CurrentUserPayload) {
    return this.clientPortalService.listOrganizations(user.id);
  }

  @Get("customers/:customerId/invoices")
  listInvoices(
    @Param("customerId") customerId: string,
    @Query(new ZodValidationPipe(listClientInvoicesQuerySchema)) query: ListClientInvoicesQueryDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.clientPortalService.listInvoices(user.id, customerId, { take: query.take, skip: query.skip });
  }
}
