import { BadRequestException, Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { createRefundSchema, type CreateRefundDto } from "./dto/create-refund.dto";
import { RefundsService } from "./refunds.service";

// Security Audit 2026-08-23, finding #2 — même en-tête et même validation UUID v4
// que PaymentsController (ADR-016) : un remboursement est aussi une mutation
// financière réelle, jamais moins protégée qu'un paiement.
const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey?: string,
  ) {
    if (!idempotencyKey || !UUID_V4_REGEX.test(idempotencyKey)) {
      throw new BadRequestException(
        `En-tête ${IDEMPOTENCY_KEY_HEADER} manquant ou invalide (UUID v4 attendu, ADR-016)`,
      );
    }
    return this.refundsService.create(creditNoteId, dto, user.id, idempotencyKey);
  }
}
