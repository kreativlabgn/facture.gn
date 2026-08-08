import { Injectable } from "@nestjs/common";
import type { PaymentProviderName } from "@facture-gn/db";
import type {
  CreatePaymentLinkRequest,
  CreatePaymentLinkResult,
  NormalizedWebhookResult,
  PaymentProvider,
  VerifyTransactionResult,
} from "../provider.interface";

const PAYMENT_LINK_TTL_DAYS = 30; // DAT §config : payment_link_ttl_days
const DJOMY_GATEWAY_FEE_BPS = 100n; // 1% annoncé, ADR-072 (à confirmer)

@Injectable()
export class DjomyStubProvider implements PaymentProvider {
  readonly name: PaymentProviderName = "djomy";

  // Non branché sur la DI Nest par défaut (délai 0 en usage réel, voir
  // payment-orchestrator.module.ts) — construit avec un délai explicite dans les
  // tests du circuit breaker uniquement.
  constructor(private readonly simulatedDelayMs = 0) {}

  async createPaymentLink(request: CreatePaymentLinkRequest): Promise<CreatePaymentLinkResult> {
    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedDelayMs));
    }

    // TODO(Djomy réel, ADR-072) : POST /confirm_otp puis /verify_payment, Djomy.africa —
    // Orange Money + MTN MoMo Guinée directs. Stub déterministe faute de credentials
    // sandbox ; interface stable, migration sans impact sur les appelants.
    const providerRef = `djomy-stub-${request.invoiceId}`;
    return {
      provider: "djomy",
      providerRef,
      paymentLinkUrl: `https://stub.djomy.africa/pay/${providerRef}`,
      feeGatewayGnf: (request.amountGnf * DJOMY_GATEWAY_FEE_BPS) / 10_000n,
      expiresAt: new Date(Date.now() + PAYMENT_LINK_TTL_DAYS * 24 * 60 * 60 * 1000),
    };
  }

  async verifyTransaction(providerRef: string): Promise<VerifyTransactionResult> {
    return { status: "success", providerRef, settledAt: new Date() };
  }

  // ATTENTION — signatureValid: true est un placeholder de stub, jamais une vraie
  // vérification. Ne jamais câbler cette méthode telle quelle sur un vrai endpoint
  // webhook sans implémenter la vérification HMAC/signature réelle de Djomy (ADR-075,
  // PAYMENT_WEBHOOKS, Phase 2) — sinon n'importe qui peut forger un webhook "payé".
  handleWebhook(rawPayload: unknown): NormalizedWebhookResult {
    const payload = rawPayload as { provider_ref: string };
    return { providerRef: payload.provider_ref, status: "paid", signatureValid: true };
  }
}
