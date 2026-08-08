import { Injectable, Logger } from "@nestjs/common";

// Distinct du timeout interne à money-api (10s Djomy dur + jusqu'à 2 tentatives
// Moneroo, ADR-073) — trust-api n'attend jamais la résolution complète de
// l'orchestrateur. DAT §12 : "Émission facture < 2s" et "Génération lien de
// paiement < 3s" sont deux budgets séparés, jamais un seul appel bloquant.
const REQUEST_TIMEOUT_MS = 3000;

export interface PaymentLinkRequest {
  invoiceId: string;
  organizationId: string;
  amountGnf: bigint;
}

export interface PaymentLinkResult {
  paymentLinkUrl: string;
  providerRef: string;
  expiresAt: Date;
}

// Ne lève jamais — un échec de génération de lien ne doit jamais faire échouer
// l'émission de facture (Parcours Fanta : cash et lien ne s'excluent jamais l'un
// l'autre). Tout échec est retourné comme null et loggé, jamais silencieux.
@Injectable()
export class PaymentLinkClient {
  private readonly logger = new Logger(PaymentLinkClient.name);

  async tryGenerate(request: PaymentLinkRequest): Promise<PaymentLinkResult | null> {
    const baseUrl = process.env.MONEY_API_URL;
    const apiKey = process.env.MONEY_API_INTERNAL_KEY;
    if (!baseUrl || !apiKey) {
      this.logger.warn(
        `MONEY_API_URL/MONEY_API_INTERNAL_KEY non configurés — génération de lien ignorée pour la facture ${request.invoiceId}`,
      );
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/payment-links`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Api-Key": apiKey,
        },
        body: JSON.stringify({
          invoiceId: request.invoiceId,
          organizationId: request.organizationId,
          amountGnf: request.amountGnf.toString(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(`money-api a répondu ${response.status} pour la facture ${request.invoiceId}`);
        return null;
      }

      const data = (await response.json()) as { paymentLinkUrl: string; providerRef: string; expiresAt: string };
      return {
        paymentLinkUrl: data.paymentLinkUrl,
        providerRef: data.providerRef,
        expiresAt: new Date(data.expiresAt),
      };
    } catch (error) {
      this.logger.warn(
        `Échec de génération du lien de paiement pour la facture ${request.invoiceId} : ${(error as Error).message}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
