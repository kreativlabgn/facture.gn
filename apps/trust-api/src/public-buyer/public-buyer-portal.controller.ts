import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { listReceivedInvoicesQuerySchema, type ListReceivedInvoicesQueryDto } from "./dto/list-received-invoices-query.dto";
import { PublicBuyerPortalService } from "./public-buyer-portal.service";

// Aucun @Roles()/@OrganizationIdSource ici, sur AUCUNE route de ce controller —
// RolesGuard résout l'organisation PME propriétaire de la facture et vérifie
// que l'appelant en est OrganizationMember. Un DAF authentique n'est membre
// d'AUCUNE organisation PME : ce guard le rejetterait systématiquement (ou pire,
// résoudrait la mauvaise identité). JwtAuthGuard (global) suffit — toute
// l'autorisation vit dans PublicBuyerPortalService, contre
// PublicBuyerAccountMember + Customer.publicBuyerAccountId. Voir PLAN,
// "Alternatives écartées".
@ApiTags("PublicBuyer")
@ApiBearerAuth()
@Controller("public-buyer")
export class PublicBuyerPortalController {
  constructor(private readonly publicBuyerPortalService: PublicBuyerPortalService) {}

  @Post("invoices/:invoiceId/validate-liquidation")
  validateLiquidation(@Param("invoiceId") invoiceId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.publicBuyerPortalService.validateLiquidation(invoiceId, user.id);
  }

  @Get("invoices")
  listReceivedInvoices(
    @Query(new ZodValidationPipe(listReceivedInvoicesQuerySchema)) query: ListReceivedInvoicesQueryDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.publicBuyerPortalService.listReceivedInvoices(user.id, { take: query.take, skip: query.skip });
  }

  // Security Audit 2026-08-23, finding #13 — confirmation explicite d'un lien
  // client<->compte acheteur public posé par une PME (flagPublicEntity()), par un
  // membre du compte CIBLÉ. Même absence de @Roles()/@OrganizationIdSource que le
  // reste de ce controller — customerId ne pointe jamais une facture/organisation.
  @Post("customers/:customerId/confirm-link")
  confirmCustomerLink(@Param("customerId") customerId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.publicBuyerPortalService.confirmCustomerLink(customerId, user.id);
  }
}
