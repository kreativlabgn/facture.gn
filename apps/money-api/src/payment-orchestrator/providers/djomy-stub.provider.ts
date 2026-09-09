import { timingSafeEqual } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { PaymentProviderName } from "@facture-gn/db";
import type {
  ChargeMobileMoneyRequest,
  ChargeMobileMoneyResult,
  CreatePaymentLinkRequest,
  CreatePaymentLinkResult,
  NormalizedWebhookResult,
  PaymentProvider,
  VerifyTransactionResult,
} from "../provider.interface";
const PAYMENT_LINK_TTL_DAYS = 30; // DAT §config : payment_link_ttl_days
// 1,4% — taux réel confirmé (corrige le 1% initialement "annoncé" d'ADR-072).
// Djomy applique un barème dégressif par volume, jamais modélisé ici faute de
// paliers exacts communiqués — 1,4% est utilisé comme taux plat uniforme,
// simplification documentée en attendant le barème complet.
const DJOMY_GATEWAY_FEE_BPS = 140n;

@Injectable()
export class DjomyStubProvider implements PaymentProvider {
  readonly name: PaymentProviderName = "djomy";
  private readonly logger = new Logger(DjomyStubProvider.name);

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

  // Débit poussé (Chantier 3) — l'autre moitié du parcours Mobile Money : ici
  // facture.gn tient le numéro et demande à Djomy de solliciter le téléphone,
  // au lieu de rediriger le payeur vers une page hébergée.
  //
  // MÊME TAUX que createPaymentLink, et calculé sur le même montant : le canal
  // d'encaissement ne change pas le barème du gateway. Deux calculs de frais
  // qui divergeraient selon le bouton cliqué feraient mentir l'écran de
  // récapitulatif, qui est rendu AVANT que ce choix soit fait.
  async chargeMobileMoney(request: ChargeMobileMoneyRequest): Promise<ChargeMobileMoneyResult> {
    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedDelayMs));
    }

    // TODO(Djomy réel, ADR-072) : POST /collect puis /confirm_otp — Djomy.africa
    // expose le débit Orange Money et MTN MoMo Guinée sur le même endpoint, le
    // réseau étant déduit du préfixe. Stub déterministe faute de credentials
    // sandbox ; le contrat de sortie ne bougera pas à la bascule.
    this.logger.log(`Débit Mobile Money simulé (${request.operator}) pour ${request.invoiceId}`);

    return {
      providerRef: `djomy-stub-charge-${request.idempotencyKey}`,
      // `pending` et JAMAIS `success` : un débit Mobile Money n'est acquis
      // qu'une fois le code composé sur le téléphone. Le stub ne prend pas
      // cette liberté — le webhook reste seul à faire passer la facture à
      // `paid`, exactement comme en production.
      status: "pending",
      feeGatewayGnf: (request.amountGnf * DJOMY_GATEWAY_FEE_BPS) / 10_000n,
      instruction:
        request.operator === "orange_money"
          ? "Composez #144# sur votre téléphone puis validez le paiement avec votre code secret Orange Money."
          : "Une demande de paiement MTN MoMo vient d'être envoyée sur votre téléphone. Validez-la avec votre code secret.",
    };
  }

  async verifyTransaction(providerRef: string): Promise<VerifyTransactionResult> {    return { status: "success", providerRef, settledAt: new Date() };
  }

  // TODO(Djomy réel, ADR-075) : remplacer par la vraie vérification HMAC de Djomy
  // quand des credentials existeront — même contrat (retourne signatureValid),
  // aucun appelant à changer. En attendant, garde par secret partagé stub : le
  // provider_ref n'est PAS un secret (visible dans l'URL du lien envoyée au client
  // par WhatsApp/SMS) — sans cette garde, n'importe qui recevant un lien de paiement
  // pourrait forger un webhook "payé" et faire créditer une facture jamais payée
  // (trouvé par dev-security-reviewer, C2 Phase 2b).
  //
  // Security Audit 2026-08-23, finding #11 (MOYEN) — décision explicite de laisser
  // ce mécanisme tel quel dans ce lot de correctifs : un secret statique comparé au
  // corps entier (au lieu d'un HMAC-SHA256 calculé sur le corps brut, pattern déjà
  // utilisé par PartnerWebhookAuthGuard/ADR-082 pour APIP) ne protège que "connaît
  // le secret", pas "ce payload précis n'a pas été altéré". Un vrai HMAC exigerait
  // de faire transiter request.rawBody (Buffer) depuis WebhooksController jusqu'ici
  // — main.ts (rawBody: true), WebhooksService.handleIncomingWebhook(), et
  // PaymentProvider.handleWebhook() devraient tous changer de contrat, pour un
  // format de payload qui sera de toute façon entièrement redéfini à la vraie
  // intégration (le format actuel {provider_ref, stub_secret} est inventé, pas
  // documenté par Djomy). Câbler cette plomberie maintenant pour un contrat
  // temporaire aurait un coût réel sans bénéfice de sécurité durable — DÉJÀ un
  // blocker connu et tracé avant bascule réelle (voir TODO ci-dessus), pas un gap
  // silencieux. À corriger AU MOMENT de la vraie intégration Djomy, pas avant.
  handleWebhook(rawPayload: unknown): NormalizedWebhookResult {
    const payload = rawPayload as { provider_ref: string; stub_secret?: string };
    return {
      providerRef: payload.provider_ref,
      status: "paid",
      signatureValid: this.isValidStubSecret(payload.stub_secret),
    };
  }

  // Fail-closed : secret non configuré → jamais un accès ouvert par oubli (contraste
  // avec InternalAuthGuard qui fail-fast au constructeur — ici un throw bloquerait
  // aussi createPaymentLink()/verifyTransaction(), sans rapport avec le webhook).
  private isValidStubSecret(provided: unknown): boolean {
    const expected = process.env.DJOMY_WEBHOOK_STUB_SECRET;
    if (!expected) {
      this.logger.warn("DJOMY_WEBHOOK_STUB_SECRET non configuré — tout webhook Djomy est rejeté");
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
