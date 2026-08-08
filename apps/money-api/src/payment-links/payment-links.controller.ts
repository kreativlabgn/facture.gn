import { Body, Controller, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { createPaymentLinkSchema, type CreatePaymentLinkDto } from "./dto/create-payment-link.dto";
import { PaymentLinksService } from "./payment-links.service";

// Pas d'authentification à cette phase (C2 Phase 1, docs/plans/2026-08-08-money-context-
// payment-orchestrator.md, Risque 2) : aucun appelant légitime tant que non branché sur
// trust-api. Authentification inter-service à trancher en Phase 2, jamais exposé
// publiquement avant cette étape.
@ApiTags("payment-links")
@Controller("payment-links")
export class PaymentLinksController {
  constructor(private readonly paymentLinksService: PaymentLinksService) {}

  @Post()
  create(@Body(new ZodValidationPipe(createPaymentLinkSchema)) dto: CreatePaymentLinkDto) {
    return this.paymentLinksService.createPaymentLink(dto.invoiceId, dto.organizationId, dto.amountGnf);
  }
}
