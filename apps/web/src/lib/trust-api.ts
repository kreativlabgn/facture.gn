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

export class TrustApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

// Un seul point d'appel authentifié — chaque fonction ci-dessous l'utilise
// plutôt que de reconstruire le header Authorization à chaque fois. Le token
// vient toujours de session.ts (cookie httpOnly), jamais transmis par un
// composant client.
async function authenticatedFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${TRUST_API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
}

export interface LoginResult {
  accessToken: string;
}

export async function login(msisdn: string, password: string): Promise<LoginResult> {
  const response = await fetch(`${TRUST_API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msisdn, password }),
    cache: "no-store",
  });
  if (response.status === 401) {
    // Message générique anti-énumération déjà appliqué côté trust-api
    // (auth.service.ts) — on ne fait que le relayer, jamais plus précis.
    throw new TrustApiError("Identifiants invalides", response.status);
  }
  if (!response.ok) {
    throw new TrustApiError("Connexion temporairement indisponible", response.status);
  }
  return response.json();
}

// Mirroir de la forme aplatie retournée par GET /organizations
// (organizations.service.ts:listMine — organisation + role du user connecté).
export interface OrganizationSummary {
  id: string;
  name: string;
  role: string;
  commercialTier: string;
}

export async function listMyOrganizations(token: string): Promise<OrganizationSummary[]> {
  const response = await authenticatedFetch("/organizations", token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger les organisations", response.status);
  }
  return response.json();
}

// Champs consommés par le dashboard uniquement (pas un mirroir exhaustif du
// modèle Invoice complet — bien plus large côté trust-api, non pertinent ici).
export interface InvoiceListItem {
  id: string;
  number: string | null;
  status: string;
  totalTtc: string;
  certificationId: string | null;
  createdAt: string;
}

export async function listInvoices(
  token: string,
  organizationId: string,
  pagination: { take?: number } = {},
): Promise<InvoiceListItem[]> {
  const params = new URLSearchParams({ organizationId });
  if (pagination.take) {
    params.set("take", String(pagination.take));
  }
  const response = await authenticatedFetch(`/invoices?${params.toString()}`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger les factures", response.status);
  }
  return response.json();
}

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
