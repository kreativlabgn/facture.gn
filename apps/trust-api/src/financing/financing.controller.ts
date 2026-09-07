import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { CurrentOrganizationId } from "../common/rbac/current-organization-id.decorator";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { chooseFinancingSchema, type ChooseFinancingDto } from "./dto/choose-financing.dto";
import { FinancingService } from "./financing.service";

// K4, ADR-088 — décision engageant un montant réel de facture : réservé
// owner/admin, jamais le DAF (déjà joué son rôle via validateLiquidation, J1).
// idSource par défaut ("invoice", RolesGuard) — comportement standard, aucune
// modification requise.
@ApiTags("financing")
@ApiBearerAuth()
@Controller("invoices/:id/financing")
export class FinancingController {
  constructor(private readonly financingService: FinancingService) {}

  @Get("options")
  @Roles("owner", "admin")
  getOptions(@Param("id") invoiceId: string, @CurrentOrganizationId() organizationId: string) {
    return this.financingService.getFinancingOptions(invoiceId, organizationId);
  }

  @Post()
  @Roles("owner", "admin")
  choose(
    @Param("id") invoiceId: string,
    @Body(new ZodValidationPipe(chooseFinancingSchema)) dto: ChooseFinancingDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrganizationId() organizationId: string,
  ) {
    return this.financingService.chooseFinancing(invoiceId, dto, user.id, organizationId);
  }
}
