import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { InternalAuthGuard } from "../common/internal-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { createPaymentLinkSchema, type CreatePaymentLinkDto } from "./dto/create-payment-link.dto";
import { PaymentLinksService } from "./payment-links.service";

// Authentification inter-service (C2 Phase 2a) — appelant légitime : trust-api
// uniquement, jamais un client final. Clé partagée, jamais mTLS (pas d'infra de
// certificats), jamais HMAC (pas un webhook tiers non fiable, ADR-082 ne s'applique
// pas ici).
@ApiTags("payment-links")
@ApiSecurity("internal-api-key")
@UseGuards(InternalAuthGuard)
@Controller("payment-links")
export class PaymentLinksController {
  constructor(private readonly paymentLinksService: PaymentLinksService) {}

  @Post()
  create(@Body(new ZodValidationPipe(createPaymentLinkSchema)) dto: CreatePaymentLinkDto) {
    return this.paymentLinksService.createPaymentLink(dto.invoiceId, dto.organizationId, dto.amountGnf);
  }
}
