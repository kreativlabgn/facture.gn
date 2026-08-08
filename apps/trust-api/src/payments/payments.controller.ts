import { BadRequestException, Body, Controller, Headers, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { Public } from "../auth/public.decorator";
import { InternalAuthGuard } from "../common/internal-auth.guard";
import { createPaymentSchema, type CreatePaymentDto } from "./dto/create-payment.dto";
import {
  confirmProviderPaymentSchema,
  type ConfirmProviderPaymentDto,
} from "./dto/confirm-provider-payment.dto";
import { PaymentsService } from "./payments.service";

const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@ApiTags("payments")
@ApiBearerAuth()
@Controller("invoices/:id/payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // :id (facture) alimente RolesGuard.resolveOrganizationId() — voir le commentaire
  // sur le DTO, aucun invoiceId dans le body pour ne pas devoir généraliser le guard.
  @Post()
  @Roles("owner", "admin", "cashier", "field_agent", "delivery_driver")
  create(
    @Param("id") invoiceId: string,
    @Body(new ZodValidationPipe(createPaymentSchema)) dto: CreatePaymentDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey?: string,
  ) {
    if (!idempotencyKey || !UUID_V4_REGEX.test(idempotencyKey)) {
      throw new BadRequestException(
        `En-tête ${IDEMPOTENCY_KEY_HEADER} manquant ou invalide (UUID v4 attendu, ADR-016)`,
      );
    }
    return this.paymentsService.recordCashPayment(invoiceId, dto, idempotencyKey);
  }

  // Appel machine-à-machine exclusif (money-api, après confirmation webhook,
  // C2 Phase 2b) — jamais un rôle humain : @Public() court-circuite JwtAuthGuard,
  // RolesGuard est un no-op sans @Roles(), InternalAuthGuard est le seul vrai garde.
  @Post("provider-confirmation")
  @Public()
  @ApiSecurity("internal-api-key")
  @UseGuards(InternalAuthGuard)
  confirmProviderPayment(
    @Param("id") invoiceId: string,
    @Body(new ZodValidationPipe(confirmProviderPaymentSchema)) dto: ConfirmProviderPaymentDto,
  ) {
    return this.paymentsService.recordProviderPayment(invoiceId, dto);
  }
}
