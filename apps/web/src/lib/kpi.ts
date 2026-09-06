import type { InvoiceListItem } from "./trust-api";

// Agrégats de l'accueil. À lire avant d'ajouter un chiffre ici :
//
// trust-api n'expose AUCUN endpoint d'agrégation pour les factures — ni
// « encaissé ce mois », ni « en attente », ni un total par statut. Le seul
// agrégat réel du domaine est GET /organizations/:id/trust-score (E8, ratio de
// paiements vérifiés), réservé owner/admin.
//
// Conséquence assumée : les chiffres ci-dessous sont calculés sur la FENÊTRE
// de factures déjà chargée par la page (les N dernières), pas sur toute
// l'organisation. Un compteur qui dirait « 50 factures » alors que
// l'organisation en a 4 000 serait un mensonge tranquille — d'où
// `windowSize`, que KpiRow est tenu d'afficher dans le libellé. Le jour où
// trust-api gagne un vrai endpoint d'agrégation, ce fichier disparaît au
// profit de l'appel réseau ; les composants, eux, ne bougent pas.
export interface InvoiceWindowKpis {
  windowSize: number;
  // Centimes GNF en string, même convention que InvoiceListItem.totalTtc :
  // la somme passe par BigInt, jamais par un number (au-delà de
  // Number.MAX_SAFE_INTEGER la précision partirait en silence).
  totalTtcCentimes: string;
  // « En attente » = émise mais pas soldée. Les brouillons n'y sont pas :
  // rien n'a encore été demandé au client. Les annulées/expirées non plus.
  awaitingPaymentCount: number;
}

const AWAITING_PAYMENT_STATUSES: readonly string[] = ["issued", "partially_paid"];

export function deriveInvoiceWindowKpis(invoices: readonly InvoiceListItem[]): InvoiceWindowKpis {
  const totalTtcCentimes = invoices.reduce((sum, invoice) => sum + BigInt(invoice.totalTtc), BigInt(0));
  return {
    windowSize: invoices.length,
    totalTtcCentimes: totalTtcCentimes.toString(),
    awaitingPaymentCount: invoices.filter((invoice) => AWAITING_PAYMENT_STATUSES.includes(invoice.status)).length,
  };
}

// ratio null = aucun paiement enregistré (jamais une division par zéro
// déguisée en 0 %, voir OrganizationTrustScore côté trust-api). On rend alors
// un tiret : « pas encore de donnée » n'est pas « 0 % ».
export function formatVerifiedPaymentRatio(ratio: number | null): string {
  if (ratio === null) {
    return "—";
  }
  return `${Math.round(ratio * 100)} %`;
}
