import { timingSafeEqual } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { PaymentProviderName } from "@facture-gn/db";
import type {
  CreatePaymentLinkRequest,
  CreatePaymentLinkResult,
  NormalizedWebhookResult,
  PaymentProvider,
  VerifyTransactionResult,
} from "../provider.interface";

const PAYMENT_LINK_TTL_DAYS = 30;

@Injectable()
export class MonerooStubProvider implements PaymentProvider {
  readonly name: PaymentProviderName = "moneroo";
  private readonly logger = new Logger(MonerooStubProvider.name);

  constructor(private readonly simulatedDelayMs = 0) {}

  async createPaymentLink(request: CreatePaymentLinkRequest): Promise<CreatePaymentLinkResult> {
    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedDelayMs));
    }

    // TODO(Moneroo réel, ADR-072) : cartes internationales + fallback bascule
    // automatique sur timeout Djomy. Stub déterministe faute de credentials sandbox.
    const providerRef = `moneroo-stub-${request.invoiceId}`;
    return {
      provider: "moneroo",
      providerRef,
      paymentLinkUrl: `https://stub.moneroo.io/pay/${providerRef}`,
      feeGatewayGnf: 0n, // frais Moneroo non encore modélisés pour ce stub (hors scope Phase 1)
      expiresAt: new Date(Date.now() + PAYMENT_LINK_TTL_DAYS * 24 * 60 * 60 * 1000),
    };
  }

  // PAS de chargeMobileMoney ici, et c'est délibéré (Chantier 3) : ce stub rend
  // `feeGatewayGnf: 0n` faute de barème Moneroo modélisé. Pousser un débit dont
  // on ne saurait pas annoncer les frais violerait la transparence tarifaire
  // qu'ADR-106 exige — le payeur verrait « 0 GNF de frais réseau » puis serait
  // débité d'autre chose. Tant que le barème n'est pas connu, Moneroo reste le
  // provider du LIEN (le payeur voit alors les frais chez Moneroo), jamais du
  // débit poussé. La méthode étant optionnelle sur l'interface, l'absence se
  // teste et se refuse en amont — elle ne se découvre pas au moment du débit.
  async verifyTransaction(providerRef: string): Promise<VerifyTransactionResult> {
    return { status: "success", providerRef, settledAt: new Date() };
  }
  // TODO(Moneroo réel, ADR-075) : remplacer par la vraie vérification de signature
  // Moneroo quand des credentials existeront — voir le même correctif sur
  // DjomyStubProvider pour le raisonnement complet (dev-security-reviewer, C2 Phase 2b).
  //
  // Security Audit 2026-08-23, finding #11 (MOYEN) — même décision explicite de
  // report que DjomyStubProvider (voir son commentaire détaillé) : câbler un vrai
  // HMAC sur request.rawBody maintenant pour un format de payload stub inventé,
  // qui sera entièrement redéfini à la vraie intégration Moneroo, n'apporte aucun
  // bénéfice de sécurité durable pour le coût de plomberie (main.ts, WebhooksService,
  // PaymentProvider). Déjà tracé comme blocker avant bascule réelle (TODO ci-dessus).
  handleWebhook(rawPayload: unknown): NormalizedWebhookResult {
    const payload = rawPayload as { provider_ref: string; stub_secret?: string };
    return {
      providerRef: payload.provider_ref,
      status: "paid",
      signatureValid: this.isValidStubSecret(payload.stub_secret),
    };
  }

  private isValidStubSecret(provided: unknown): boolean {
    const expected = process.env.MONEROO_WEBHOOK_STUB_SECRET;
    if (!expected) {
      this.logger.warn("MONEROO_WEBHOOK_STUB_SECRET non configuré — tout webhook Moneroo est rejeté");
      return false;
    }
    if (typeof provided !== "string") {
      return false;
    }
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(providedBuf, expectedBuf);
  }
}
