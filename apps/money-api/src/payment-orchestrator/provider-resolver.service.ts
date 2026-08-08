import { Inject, Injectable } from "@nestjs/common";
import type { PaymentProviderName } from "@facture-gn/db";
import { DJOMY_PROVIDER, MONEROO_PROVIDER } from "./payment-orchestrator.tokens";
import type { PaymentProvider } from "./provider.interface";

@Injectable()
export class ProviderResolverService {
  constructor(
    @Inject(DJOMY_PROVIDER) private readonly djomy: PaymentProvider,
    @Inject(MONEROO_PROVIDER) private readonly moneroo: PaymentProvider,
  ) {}

  // orange_direct/mtn_direct : cibles V1 (ADR-073), pas encore de provider stub —
  // null plutôt qu'une exception, l'appelant (WebhooksService) décide du 400.
  resolve(name: PaymentProviderName): PaymentProvider | null {
    switch (name) {
      case "djomy":
        return this.djomy;
      case "moneroo":
        return this.moneroo;
      default:
        return null;
    }
  }
}
