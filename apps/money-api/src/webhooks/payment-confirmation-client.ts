import { Injectable } from "@nestjs/common";
import type { PaymentProviderName } from "@facture-gn/db";

// Généreux, pas agressif comme PaymentLinkClient (trust-api) côté Phase 2a : on VEUT
// attendre la confirmation avant de répondre au fournisseur — la classe de
// conséquence est différente (paiement réel non tracé, pas juste un lien manquant).
const CONFIRMATION_TIMEOUT_MS = 8000;

export interface PaymentConfirmationRequest {
  invoiceId: string;
  amountGnf: bigint;
  provider: PaymentProviderName;
  providerRef: string;
  feeGatewayGnf: bigint;
}

// Ne catch JAMAIS — contrairement à PaymentLinkClient. Un échec doit remonter
// jusqu'au contrôleur webhook pour qu'il réponde en erreur au fournisseur
// (Djomy/Moneroo redélivrera), plutôt que d'être avalé silencieusement.
@Injectable()
export class PaymentConfirmationClient {
  async confirm(request: PaymentConfirmationRequest): Promise<void> {
    const baseUrl = process.env.TRUST_API_URL;
    const apiKey = process.env.MONEY_API_INTERNAL_KEY;
    if (!baseUrl || !apiKey) {
      throw new Error(
        "TRUST_API_URL/MONEY_API_INTERNAL_KEY non configurés — confirmation de paiement impossible",
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIRMATION_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/invoices/${request.invoiceId}/payments/provider-confirmation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Api-Key": apiKey,
        },
        body: JSON.stringify({
          amountGnf: request.amountGnf.toString(),
          provider: request.provider,
          providerRef: request.providerRef,
          feeGatewayGnf: request.feeGatewayGnf.toString(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `trust-api a répondu ${response.status} pour la confirmation de ${request.providerRef}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
