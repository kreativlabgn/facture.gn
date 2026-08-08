import { BadRequestException, Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { createPaymentSchema, type CreatePaymentDto } from "./dto/create-payment.dto";
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
}
