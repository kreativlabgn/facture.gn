// Bounded context distinct de trust-api.ts, jamais mélangés — cet écran (page
// de pré-checkout publique, C19) est le premier de ce repo à parler
// directement au Money Context depuis le frontend. Aucun token : le payeur
// n'est jamais un utilisateur authentifié de facture.gn.
const MONEY_API_URL = process.env.MONEY_API_URL ?? "http://localhost:3001";

export class MoneyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

// Mirroir de GET /payment-links/:invoiceId/checkout (payment-links.controller.ts,
// PaymentLinksService.getPublicCheckout). amountGnf/feeGatewayGnf en centimes GNF
// (BigInt sérialisé en string, même convention que trust-api.ts).
export interface PublicCheckout {
  provider: string;
  paymentLinkUrl: string | null;
  amountGnf: string;
  feeGatewayGnf: string;
  expiresAt: string | null;
}

export async function fetchPublicCheckout(invoiceId: string): Promise<PublicCheckout | null> {
  const response = await fetch(`${MONEY_API_URL}/payment-links/${encodeURIComponent(invoiceId)}/checkout`, {
    // Un lien de paiement peut être régénéré (C18) — jamais une valeur mise en
    // cache, même principe que fetchInvoiceVerification (trust-api.ts).
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new MoneyApiError("Checkout temporairement indisponible", response.status);
  }
  return response.json();
}
