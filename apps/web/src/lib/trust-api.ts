// Mirroir de PublicInvoiceVerification (apps/trust-api/src/verification/verification.service.ts)
// — pas de package de types partagés dans ce monorepo pour l'instant (un seul
// type consommé ici, l'extraire maintenant serait une abstraction prématurée ;
// à reconsidérer si un 2e type devait être partagé, même discipline "règle des
// trois" déjà appliquée côté backend cette session).
export interface PublicInvoiceVerification {
  certificationId: string;
  number: string;
  organizationName: string;
  organizationNif: string | null;
  totalTtc: string;
  issuedAt: string;
  status: string;
  disputeStatus: string;
  validatedByAdministration: boolean;
  integrityValid: boolean;
}

// Server-only : jamais exposé au client (TRUST_API_URL n'a pas le préfixe
// NEXT_PUBLIC_). Le fetch se fait dans un Server Component, le navigateur ne
// voit jamais l'URL interne du service.
const TRUST_API_URL = process.env.TRUST_API_URL ?? "http://localhost:3000";

export async function fetchInvoiceVerification(
  certificationId: string,
): Promise<PublicInvoiceVerification | null> {
  const response = await fetch(`${TRUST_API_URL}/verify/${encodeURIComponent(certificationId)}`, {
    // Vérification en temps réel (même principe que C10, jamais une valeur
    // mise en cache) — une facture peut changer de statut (litige, paiement)
    // entre deux vérifications du même identifiant.
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Échec de la vérification (${response.status})`);
  }

  return response.json();
}
