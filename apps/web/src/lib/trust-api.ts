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

// Mirroir de GET /organizations/:id — champs affichés sur la page paramètres
// uniquement (pas un mirroir exhaustif du modèle Organization complet).
export interface OrganizationDetail {
  id: string;
  name: string;
  regimeFiscal: string;
  legalForm: string;
  nif: string | null;
  rccm: string | null;
  commercialTier: string;
  dgiVerificationStatus: string;
}

export async function getOrganization(token: string, organizationId: string): Promise<OrganizationDetail> {
  const response = await authenticatedFetch(`/organizations/${encodeURIComponent(organizationId)}`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger l'organisation", response.status);
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

// Champs consommés par le sélecteur client de l'émission de facture et la
// section "liste des clients" — pas un mirroir exhaustif de Customer.
export interface CustomerListItem {
  id: string;
  name: string;
  phone: string | null;
  nif: string | null;
}

export async function listCustomers(
  token: string,
  organizationId: string,
  pagination: { take?: number } = {},
): Promise<CustomerListItem[]> {
  const params = new URLSearchParams({ organizationId });
  if (pagination.take) {
    params.set("take", String(pagination.take));
  }
  const response = await authenticatedFetch(`/customers?${params.toString()}`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger les clients", response.status);
  }
  return response.json();
}

export interface CreateCustomerInput {
  organizationId: string;
  name: string;
  phone?: string;
  nif?: string;
  notificationChannel?: "sms" | "whatsapp" | "both";
}

export async function createCustomer(token: string, input: CreateCustomerInput): Promise<CustomerListItem> {
  const response = await authenticatedFetch("/customers", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Création du client impossible", response.status);
  }
  return response.json();
}

export interface CreateInvoiceLineInput {
  description: string;
  quantity: number;
  // Centimes GNF (convention repo — voir schema.prisma), jamais des GNF
  // directs : la conversion ×100 se fait dans le Server Action appelant,
  // jamais côté formulaire client (l'utilisateur saisit des GNF naturels).
  unitPrice: string;
}

export interface CreateInvoiceInput {
  organizationId: string;
  documentType: "invoice" | "proforma" | "quote";
  customerId?: string;
  lines: CreateInvoiceLineInput[];
}

export interface InvoiceDetail {
  id: string;
  number: string | null;
  status: string;
  totalTtc: string;
  certificationId: string | null;
}

export async function createInvoice(token: string, input: CreateInvoiceInput): Promise<InvoiceDetail> {
  const response = await authenticatedFetch("/invoices", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Création de la facture impossible", response.status);
  }
  return response.json();
}

export async function issueInvoice(token: string, invoiceId: string): Promise<InvoiceDetail> {
  const response = await authenticatedFetch(`/invoices/${encodeURIComponent(invoiceId)}/issue`, token, {
    method: "POST",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Émission de la facture impossible", response.status);
  }
  return response.json();
}

// Mirroir de la forme aplatie retournée par GET /practices/mine
// (practices.service.ts:listMine — practice + role du user connecté).
export interface PracticeSummary {
  id: string;
  name: string;
  type: string;
  tier: string;
  role: string;
}

export async function listMyPractices(token: string): Promise<PracticeSummary[]> {
  const response = await authenticatedFetch("/practices/mine", token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger les cabinets", response.status);
  }
  return response.json();
}

// Mirroir de GET /practices/:id/organizations — mandats actifs uniquement
// (mandates.service.ts:listAccessibleOrganizations), organisation imbriquée
// limitée à id+name (c'est tout ce que l'endpoint sélectionne côté trust-api).
export interface AccessibleOrganizationMandate {
  id: string;
  organizationId: string;
  grantedRole: string;
  organization: { id: string; name: string };
}

export async function listAccessibleOrganizations(
  token: string,
  practiceId: string,
): Promise<AccessibleOrganizationMandate[]> {
  const response = await authenticatedFetch(`/practices/${encodeURIComponent(practiceId)}/organizations`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger les organisations clientes", response.status);
  }
  return response.json();
}

// Mirroir de GET /organizations/:id/invoices et GET /organizations/:id/customers
// (cabinet-view.controller.ts) — routes distinctes de listInvoices()/listCustomers()
// ci-dessus : celles-ci acceptent un accès par mandat actif (cabinet/CGA), pas
// seulement OrganizationMember (voir OrganizationAccessService).
export async function listOrganizationInvoicesForCabinet(token: string, organizationId: string): Promise<InvoiceListItem[]> {
  const response = await authenticatedFetch(`/organizations/${encodeURIComponent(organizationId)}/invoices`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger les factures de cette organisation", response.status);
  }
  return response.json();
}

export async function listOrganizationCustomersForCabinet(token: string, organizationId: string): Promise<CustomerListItem[]> {
  const response = await authenticatedFetch(`/organizations/${encodeURIComponent(organizationId)}/customers`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger les clients de cette organisation", response.status);
  }
  return response.json();
}

// Mirroir de GET /practices/:id/members (practices.service.ts:listMembers).
export interface PracticeMemberItem {
  id: string;
  role: string;
  user: { id: string; name: string };
}

export async function listPracticeMembers(token: string, practiceId: string): Promise<PracticeMemberItem[]> {
  const response = await authenticatedFetch(`/practices/${encodeURIComponent(practiceId)}/members`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger les collaborateurs", response.status);
  }
  return response.json();
}

export async function inviteMember(token: string, practiceId: string, msisdn: string): Promise<PracticeMemberItem> {
  const response = await authenticatedFetch(`/practices/${encodeURIComponent(practiceId)}/members`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msisdn, role: "accountant_external" }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Invitation impossible", response.status);
  }
  return response.json();
}

// Mirroir de GET /practices/:id/mandates (mandates.service.ts:listAll).
export interface PracticeMandateItem {
  id: string;
  status: string;
  grantedRole: string;
  initiatedBy: string;
  organization: { id: string; name: string };
}

export async function listPracticeMandates(token: string, practiceId: string): Promise<PracticeMandateItem[]> {
  const response = await authenticatedFetch(`/practices/${encodeURIComponent(practiceId)}/mandates`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger les mandats", response.status);
  }
  return response.json();
}

export async function requestMandate(token: string, practiceId: string, organizationId: string): Promise<PracticeMandateItem> {
  const response = await authenticatedFetch(`/practices/${encodeURIComponent(practiceId)}/mandates`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId, grantedRole: "accountant_external" }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Demande de mandat impossible", response.status);
  }
  return response.json();
}

export async function revokeMandate(token: string, practiceId: string, mandateId: string): Promise<void> {
  const response = await authenticatedFetch(
    `/practices/${encodeURIComponent(practiceId)}/mandates/${encodeURIComponent(mandateId)}/revoke`,
    token,
    { method: "POST" },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Révocation impossible", response.status);
  }
}

export async function acceptMandateRequest(token: string, practiceId: string, mandateId: string): Promise<void> {
  const response = await authenticatedFetch(
    `/practices/${encodeURIComponent(practiceId)}/mandates/${encodeURIComponent(mandateId)}/accept-request`,
    token,
    { method: "POST" },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Acceptation impossible", response.status);
  }
}

// Mirroir de GET /organizations/:id/trust-score (getVerifiedPaymentRatio, E8) —
// totalAmount/verifiedAmount en centimes GNF (BigInt sérialisé en string, même
// convention que totalTtc). ratio null tant qu'aucun paiement n'existe (jamais
// une division par zéro déguisée en 0%).
export interface OrganizationTrustScore {
  totalAmount: string;
  verifiedAmount: string;
  ratio: number | null;
}

export async function getTrustScore(token: string, organizationId: string): Promise<OrganizationTrustScore> {
  const response = await authenticatedFetch(`/organizations/${encodeURIComponent(organizationId)}/trust-score`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger le taux de paiements vérifiés", response.status);
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
