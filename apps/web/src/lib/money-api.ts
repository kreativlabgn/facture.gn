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
  /** ATTENTION — ce n'est PAS le prix de la marchandise. InvoicesService.issue()
   *  transmet `totalTtc + platformFee` : ce montant porte déjà la commission
   *  facture.gn. Le prix de la marchandise vaut `amountGnf - feePlatformGnf`. */
  amountGnf: string;
  feeGatewayGnf: string;
  /** Commission facture.gn effectivement prélevée sur CETTE tentative. Déjà
   *  persistée depuis l'origine (PaymentProviderAttempt.fee_platform), elle
   *  n'était simplement pas exposée — d'où un « Montant de la facture » qui
   *  n'en était pas un. */
  feePlatformGnf: string;
  expiresAt: string | null;
  /** Chantier 3 — l'état du DOCUMENT, décidé par money-api (payment-eligibility.ts).
   *  L'écran ne rejuge pas : deux jeux de règles finiraient par diverger, et la
   *  divergence coûteuse est celle où l'écran ouvre ce que le serveur refuse. */
  payable: boolean;
  motifRefus: string | null;
  /** Prêt à afficher, rédigé pour le PAYEUR — jamais un code d'erreur à traduire
   *  côté web, jamais une description de l'état interne du document. */
  messageRefus: string | null;
}

export interface MobileMoneyCharge {
  providerRef: string;
  status: "pending";
  operator: string;
  /** Ce que le payeur doit faire MAINTENANT sur son téléphone. */
  instruction: string;
  totalDebiteGnf: string;
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

// Chantier 3 — POST /payment-links/:invoiceId/charge, la seule route de money-api
// que ce fichier appelle avec une clé. Le GET checkout au-dessus est public
// parce qu'il ne fait que lire ; celui-ci engage l'argent du payeur.
//
// LA CLÉ NE QUITTE PAS LE SERVEUR : cette fonction n'est appelée que depuis une
// Server Action. MONEY_API_INTERNAL_KEY n'a pas de préfixe NEXT_PUBLIC_, elle
// n'est donc jamais incluse dans un bundle client — même règle que TRUST_API_URL.
export async function chargeMobileMoney(
  invoiceId: string,
  msisdn: string,
  operator: string,
): Promise<MobileMoneyCharge> {
  const cle = process.env.MONEY_API_INTERNAL_KEY;
  if (!cle) {
    // Fail-closed et explicite : sans clé, money-api rendrait un 401 que le
    // payeur lirait comme un refus de sa banque. Mieux vaut une panne nommée.
    throw new MoneyApiError("Paiement Mobile Money non configuré sur ce serveur", 500);
  }

  const response = await fetch(
    `${MONEY_API_URL}/payment-links/${encodeURIComponent(invoiceId)}/charge`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-api-key": cle },
      body: JSON.stringify({ msisdn, operator }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    // 409 (facture non payable, débit déjà en vol) et 503 (provider indisponible)
    // portent un message écrit POUR le payeur, côté money-api : on le remonte tel
    // quel plutôt que d'en inventer un second qui dirait autre chose.
    const message = await lireMessageErreur(response);
    throw new MoneyApiError(message, response.status);
  }

  return response.json();
}

// Nest sérialise ses exceptions en { message, statusCode } — mais un 502 d'un
// proxy rendrait du HTML. On ne suppose donc jamais que le corps est du JSON
// exploitable, et on retombe sur une phrase neutre plutôt que d'afficher au
// payeur un fragment de page d'erreur d'infrastructure.
async function lireMessageErreur(response: Response): Promise<string> {
  try {
    const corps = await response.json();
    const message = (corps as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  } catch {
    // Corps illisible : rien à en tirer, la phrase par défaut fera mieux.
  }
  return "Le paiement n'a pas pu être lancé. Réessayez dans un instant.";
}
