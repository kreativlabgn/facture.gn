import { Body, Controller, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { createRefundSchema, type CreateRefundDto } from "./dto/create-refund.dto";
import { RefundsService } from "./refunds.service";

@ApiTags("refunds")
@ApiBearerAuth()
@Controller("credit-notes/:id/refunds")
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  // :id (avoir) alimente RolesGuard.resolveOrganizationId() via
  // @OrganizationIdSource("credit-note") — jamais le trio owner/admin/cashier de
  // CreditNote : un remboursement fait sortir de l'argent réel, portée owner/admin
  // uniquement (même restriction que void(), plus stricte que l'avoir lui-même).
  @Post()
  @Roles("owner", "admin")
  @OrganizationIdSource("credit-note")
  create(
    @Param("id") creditNoteId: string,
    @Body(new ZodValidationPipe(createRefundSchema)) dto: CreateRefundDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.refundsService.create(creditNoteId, dto, user.id);
  }
}
