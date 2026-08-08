import { Injectable } from "@nestjs/common";
import { PaymentProviderRegistryService } from "../payment-orchestrator/provider-registry.service";
import type { CreatePaymentLinkResult } from "../payment-orchestrator/provider.interface";

@Injectable()
export class PaymentLinksService {
  constructor(private readonly registry: PaymentProviderRegistryService) {}

  createPaymentLink(invoiceId: string, organizationId: string, amountGnf: bigint): Promise<CreatePaymentLinkResult> {
    return this.registry.resolve({ invoiceId, organizationId, amountGnf });
  }
}
