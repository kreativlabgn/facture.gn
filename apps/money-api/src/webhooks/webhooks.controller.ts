import { Body, Controller, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { PaymentProviderName } from "@facture-gn/db";
import { WebhooksService } from "./webhooks.service";

// Public par conception (pas d'InternalAuthGuard) — le fournisseur (Djomy/Moneroo)
// n'est pas trust-api, il n'a pas le secret partagé. L'authentification est la
// signature du payload elle-même (WebhooksService.handleIncomingWebhook, via
// provider.handleWebhook().signatureValid), pas un secret côté transport.
//
// Aucun try/catch ici volontairement : une exception qui remonte devient un 500 Nest
// par défaut — c'est le signal voulu pour déclencher la redélivraison du webhook côté
// fournisseur (ADR-075). Ne JAMAIS ajouter de try/catch qui avalerait cette erreur.
@ApiTags("webhooks")
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post(":provider")
  async receive(@Param("provider") provider: string, @Body() rawPayload: unknown) {
    await this.webhooksService.handleIncomingWebhook(provider as PaymentProviderName, rawPayload);
    return { received: true };
  }
}
