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

export interface RegisterInput {
  name: string;
  msisdn: string;
  password: string;
}

export interface RegisterResult {
  userId: string;
}

// POST /auth/register ne renvoie QUE { userId } — aucun jeton. Le tunnel
// d'inscription enchaîne donc sur login() pour obtenir l'accessToken qui
// signera la création de l'organisation (voir (auth)/register/actions.ts).
//
// Le message d'erreur de trust-api est relayé tel quel, jamais reformulé : sur
// un numéro déjà connu, l'API répond volontairement « Code invalide ou expiré »
// (anti-énumération, auth.service.ts) — préciser ici « ce numéro a déjà un
// compte » annulerait cette protection.
export async function register(input: RegisterInput): Promise<RegisterResult> {
  const response = await fetch(`${TRUST_API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Inscription temporairement indisponible", response.status);
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

export interface CreateOrganizationInput {
  name: string;
  regimeFiscal: string;
  legalForm: string;
  nif?: string;
  etaxNumber?: string;
  rccm?: string;
}

// POST /organizations — le créateur devient owner (organizations.service.ts).
// nif/etaxNumber sont conjoints côté DTO (ADR-035) : on les omet plutôt que de
// les envoyer vides, une chaîne vide échouerait le .min(1) du schéma.
export async function createOrganization(
  token: string,
  input: CreateOrganizationInput,
): Promise<OrganizationSummary & { regimeFiscal: string; legalForm: string }> {
  const response = await authenticatedFetch("/organizations", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    // Le pipe Zod de trust-api renvoie un tableau de messages sur 400 — on
    // prend le premier plutôt que d'afficher "[object Object]".
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
    throw new TrustApiError(message ?? "Création de l'organisation impossible", response.status);
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
  etaxNumber: string | null;
  rccm: string | null;
  commercialTier: string;
  dgiVerificationStatus: string;
}

// Première route @Patch du service (voir update-organization.dto.ts).
// `null` efface un champ, `undefined` ne le touche pas — la distinction est
// portée jusqu'ici, sans quoi un NIF saisi par erreur serait ineffaçable.
export interface UpdateOrganizationInput {
  name?: string;
  regimeFiscal?: string;
  legalForm?: string;
  nif?: string | null;
  etaxNumber?: string | null;
  rccm?: string | null;
}

export async function updateOrganization(
  token: string,
  organizationId: string,
  input: UpdateOrganizationInput,
): Promise<OrganizationDetail> {
  const response = await authenticatedFetch(`/organizations/${encodeURIComponent(organizationId)}`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = Array.isArray(body?.message)
      ? body.message.join(", ")
      : typeof body?.message === "string"
        ? body.message
        : body?.fieldErrors
          ? Object.values(body.fieldErrors).flat().map(String).join(" · ")
          : body?.formErrors?.join(", ");
    throw new TrustApiError(message || "Modification impossible", response.status);
  }
  return response.json();
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
// possibleDuplicateOf (E4/E9, ADR-038) : UUID brut déjà renvoyé par
// GET /customers (aucun select/include ne le filtre côté trust-api), utilisé
// ici seulement comme signal booléen pour le badge de la liste — le nom
// lisible du candidat n'est résolu que sur l'écran détail (CustomerDetail
// ci-dessous, getCustomer()).
export interface CustomerListItem {
  id: string;
  name: string;
  phone: string | null;
  nif: string | null;
  possibleDuplicateOf: string | null;
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

// Mirroir de GET /customers/:id (findOneWithBalance) — écran détail client
// (E4/E9, ADR-038). runningBalance/creditLimit en centimes GNF sérialisés en
// string (même convention que totalTtc, voir main.ts:BigInt.prototype.toJSON).
// duplicateOf {id, name} résolu côté trust-api seulement quand
// possibleDuplicateOf est renseigné — jamais fabriqué ici.
export interface CustomerDetail {
  id: string;
  name: string;
  phone: string | null;
  nif: string | null;
  creditLimit: string | null;
  runningBalance: string;
  possibleDuplicateOf: string | null;
  duplicateOf: { id: string; name: string } | null;
}

export async function getCustomer(token: string, customerId: string): Promise<CustomerDetail> {
  const response = await authenticatedFetch(`/customers/${encodeURIComponent(customerId)}`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger ce client", response.status);
  }
  return response.json();
}

// E4, ADR-038 — POST /customers/:id/merge, réservé owner/admin + palier Pro+
// côté trust-api (isAdvancedCustomerManagementAllowed). :id est le client
// CANONIQUE conservé, duplicateCustomerId dans le body est supprimé
// (irréversible, factures réassignées) — jamais l'inverse. Le message
// d'erreur de l'API (ex. palier insuffisant) est déjà clair en français,
// relayé tel quel plutôt que remplacé par un message générique.
export async function mergeCustomer(
  token: string,
  canonicalCustomerId: string,
  duplicateCustomerId: string,
): Promise<CustomerDetail> {
  const response = await authenticatedFetch(`/customers/${encodeURIComponent(canonicalCustomerId)}/merge`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ duplicateCustomerId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Fusion des clients impossible", response.status);
  }
  return response.json();
}

// Champs consommés par la liste produits (dashboard) — mirroir de GET /products
// (ProductsService.findAllByOrganization). possibleDuplicateOf : UUID brut
// (même convention que CustomerListItem), utilisé seulement comme signal
// booléen pour le badge — le nom lisible du candidat n'est résolu que sur
// l'écran détail (ProductDetail ci-dessous, getProduct()). costPrice en
// centimes GNF sérialisé string (comme creditLimit), nullable — E6 : la
// création d'un produit n'est jamais bloquée par l'absence de coût.
export interface ProductListItem {
  id: string;
  name: string;
  costPrice: string | null;
  possibleDuplicateOf: string | null;
}

export async function listProducts(
  token: string,
  organizationId: string,
  pagination: { take?: number } = {},
): Promise<ProductListItem[]> {
  const params = new URLSearchParams({ organizationId });
  if (pagination.take) {
    params.set("take", String(pagination.take));
  }
  const response = await authenticatedFetch(`/products?${params.toString()}`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger les produits", response.status);
  }
  return response.json();
}

// Mirroir de GET /products/:id (findOneWithDuplicate) — écran détail produit
// (UI backlog gap). duplicateOf {id, name} résolu côté trust-api seulement
// quand possibleDuplicateOf est renseigné — jamais fabriqué ici. Pas de
// runningBalance (aucun équivalent pour un produit) ni de merge() (E3,
// décision actée : la fusion n'est demandée par le Backlog que pour les
// clients, E4).
export interface ProductDetail {
  id: string;
  name: string;
  costPrice: string | null;
  possibleDuplicateOf: string | null;
  duplicateOf: { id: string; name: string } | null;
}

export async function getProduct(token: string, productId: string): Promise<ProductDetail> {
  const response = await authenticatedFetch(`/products/${encodeURIComponent(productId)}`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger ce produit", response.status);
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
  // K3, ADR-090 — "Référence marché TELEMO", recopiée à la main, aucune
  // vérification automatique côté serveur. Optionnel : une facture sans
  // référence suit exactement le même parcours qu'une facture avec référence.
  referenceMarche?: string;
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


// ── Détail de facture ───────────────────────────────────────────────────────
//
// Mirroir de ce que renvoie GET /invoices/:id depuis que findOne() remonte les
// lignes, les événements et le client (invoices.service.ts). Volontairement
// PARTIEL : Invoice porte une soixantaine de colonnes (change, affacturage,
// ancrage Merkle, cadre B2G…) dont l'écran n'affiche rien. Déclarer ici les
// seules consommées documente ce que la page utilise réellement.

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  /** Centimes GNF, sérialisé en chaîne — voir formatGnf. */
  unitPrice: string;
  taxRateBps: number;
  productCode: string | null;
}

// La trace WORM (ADR-015) : append-only, jamais modifiée ni supprimée. C'est
// ce qui rend la facture opposable, et cet écran est le seul endroit où une
// PME peut la lire.
export interface InvoiceEventItem {
  id: string;
  type: string;
  amount: string | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

export interface InvoiceFullDetail {
  id: string;
  number: string | null;
  status: string;
  documentType: string;
  disputeStatus: string;
  validatedByAdministration: boolean;
  emissionChannel: string;

  totalHt: string;
  totalTva: string;
  totalTtc: string;
  amountPaid: string;
  amountDue: string;

  // Preuve de certification. `hash` et `certificationId` ne sont renseignés
  // qu'après émission — un brouillon n'a rien à prouver.
  certificationId: string | null;
  hash: string | null;
  previousHash: string | null;

  paymentLinkUrl: string | null;
  paymentLinkExpiresAt: string | null;

  referenceMarche: string | null;
  issuedAt: string | null;
  createdAt: string;

  // K5, ADR-089 — état de cession de la créance. `GET /invoices/:id` renvoie la
  // ligne Invoice entière (InvoicesService.findOne n'applique aucun `select` de
  // premier niveau) : ces deux colonnes arrivaient déjà, elles n'étaient
  // simplement pas déclarées ici. Le NOM du cessionnaire, lui, n'y est pas —
  // il vient de getFinancingOptions(), seule route qui joint financial_partner.
  financedByPartnerId: string | null;
  financedAt: string | null;

  customer: { id: string; name: string; phone: string | null; nif: string | null } | null;
  lines: InvoiceLineItem[];
  events: InvoiceEventItem[];
}

export async function getInvoice(token: string, invoiceId: string): Promise<InvoiceFullDetail> {
  const response = await authenticatedFetch(`/invoices/${encodeURIComponent(invoiceId)}`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger la facture", response.status);
  }
  return response.json();
}

// Les quatre actions de l'écran. Chacune relaie le message de trust-api tel
// quel : il est déjà écrit pour être lu par un humain (« Une facture avec un
// paiement enregistré ne peut être annulée — utiliser un avoir »), et le
// remplacer par un texte générique perdrait la seule explication utile.
export async function voidInvoice(token: string, invoiceId: string): Promise<InvoiceDetail> {
  const response = await authenticatedFetch(`/invoices/${encodeURIComponent(invoiceId)}/void`, token, {
    method: "POST",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Annulation impossible", response.status);
  }
  return response.json();
}

export async function sendInvoiceReminder(token: string, invoiceId: string): Promise<void> {
  const response = await authenticatedFetch(`/invoices/${encodeURIComponent(invoiceId)}/send-reminder`, token, {
    method: "POST",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Relance impossible", response.status);
  }
}

export async function regeneratePaymentLink(token: string, invoiceId: string): Promise<void> {
  const response = await authenticatedFetch(
    `/invoices/${encodeURIComponent(invoiceId)}/regenerate-payment-link`,
    token,
    { method: "POST" },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Régénération du lien impossible", response.status);
  }
}

// ── RAILS DE FINANCEMENT B2G — ADR-088/089, K4/K5 ───────────────────────────
//
// Les deux routes de `/invoices/:id/financing` portent @Roles("owner","admin").
// Les appeler depuis un écran non filtré ne serait pas une faille — RolesGuard
// reste seul juge et rendrait 403 — mais un appel qui ne peut que échouer n'a
// pas de raison d'être émis : voir hasPermission(role, "invoices:financing").

export interface FinancialPartnerOption {
  id: string;
  name: string;
  type: string;
}

export interface FinancingOptions {
  // Verdict d'is_financeable() (ADR-031 : « règle composite unique, toute
  // modification est un ADR »). Deux de ses cinq conditions — compte acheteur
  // public « verified », rattachement client confirmé — ne figurent NULLE PART
  // dans InvoiceFullDetail : recopier la règle côté web est impossible, et
  // l'approcher afficherait un rail que trust-api refuserait ensuite.
  financeable: boolean;
  partners: FinancialPartnerOption[];
  // K5 — renseigné dès que la créance est cédée, c'est-à-dire exactement quand
  // `financeable` retombe à false et que `partners` se vide.
  financedByPartner: { id: string; name: string } | null;
}

export type DisbursementMethod = "payment_link_payout" | "bank_transfer";

export async function getFinancingOptions(token: string, invoiceId: string): Promise<FinancingOptions> {
  const response = await authenticatedFetch(`/invoices/${encodeURIComponent(invoiceId)}/financing/options`, token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger les rails de financement", response.status);
  }
  return response.json();
}

// K5 — LA CESSION. Le 409 rendu sur une facture déjà cédée n'est pas un aléa
// réseau : c'est l'invariant anti-double-financement qui s'exprime (updateMany
// conditionnel, count = 0). Son message est relayé tel quel, comme partout
// ailleurs dans ce fichier — le reformuler perdrait la seule explication utile.
export async function chooseFinancing(
  token: string,
  invoiceId: string,
  input: { financialPartnerId: string; disbursementMethod: DisbursementMethod },
): Promise<void> {
  const response = await authenticatedFetch(`/invoices/${encodeURIComponent(invoiceId)}/financing`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Financement impossible", response.status);
  }
}


// ── Portail client (F13, ADR-096) ───────────────────────────────────────────
//
// L'ACHETEUR, PAS LA FACTURE. C'est le point à ne pas inverser : l'OTP
// s'adresse à un NUMÉRO et ouvre l'accès à toutes les factures que ce numéro a
// reçues, de toutes les entreprises qui l'ont facturé. Aucune route ne prend
// un invoiceId, et aucune ne rend une facture seule.
//
// Le parcours qui part d'UNE facture existe déjà ailleurs : /pay/[invoiceId],
// servi par money-api, pour un payeur sans compte arrivé par un lien. Les deux
// ne se remplacent pas.
//
// Ces fonctions sont SERVER-ONLY comme le reste de ce fichier : TRUST_API_URL
// n'a pas le préfixe NEXT_PUBLIC_, et le token de portail ne doit jamais
// atteindre le navigateur — il vit dans un cookie httpOnly (portal-session.ts).

export async function requestPortalOtp(msisdn: string): Promise<void> {
  const response = await fetch(`${TRUST_API_URL}/client-portal/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ msisdn }),
  });
  if (!response.ok) {
    throw new TrustApiError(await messageDErreur(response, "Envoi du code impossible"), response.status);
  }
}

// Rend `accessToken`, pas `token` : c'est le nom que renvoie
// ClientPortalAuthService.verifyOtp, et le renommer ici obligerait à traduire
// dans les deux sens à chaque appel. Le code est à 4 chiffres (verify-otp.dto).
export async function verifyPortalOtp(msisdn: string, code: string): Promise<{ accessToken: string }> {
  const response = await fetch(`${TRUST_API_URL}/client-portal/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ msisdn, code }),
  });
  if (!response.ok) {
    throw new TrustApiError(await messageDErreur(response, "Code invalide ou expiré"), response.status);
  }
  return response.json();
}

// Une entrée par CLIENT (Customer), pas par organisation : le même acheteur a
// une fiche distincte chez chaque entreprise qui le facture, et c'est
// `customerId` — pas `organizationId` — qui ouvre la liste des factures.
export interface PortalOrganizationSummary {
  organizationId: string;
  organizationName: string;
  customerId: string;
  /** Centimes GNF en chaîne. Somme des factures encore dues, pas un plafond. */
  runningBalance: string;
  /** null = aucun plafond posé par cette entreprise. */
  creditLimit: string | null;
}

export async function listPortalOrganizations(token: string): Promise<PortalOrganizationSummary[]> {
  const response = await authenticatedFetch("/client-portal/organizations", token);
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger vos comptes", response.status);
  }
  return response.json();
}

// Les brouillons et les factures annulées sont exclus côté serveur : un
// acheteur ne voit jamais un document que la PME n'a pas émis.
export async function listPortalInvoices(
  token: string,
  customerId: string,
  pagination: { take?: number; skip?: number } = {},
): Promise<InvoiceListItem[]> {
  const params = new URLSearchParams();
  if (pagination.take) params.set("take", String(pagination.take));
  if (pagination.skip) params.set("skip", String(pagination.skip));
  const suffixe = params.toString() ? `?${params.toString()}` : "";

  const response = await authenticatedFetch(
    `/client-portal/customers/${encodeURIComponent(customerId)}/invoices${suffixe}`,
    token,
  );
  if (!response.ok) {
    // 404 volontairement opaque côté trust-api : client inexistant et client
    // d'un tiers rendent le même statut, pour ne jamais confirmer l'existence
    // d'un customerId à qui n'y a pas droit. On relaie sans l'interpréter.
    throw new TrustApiError("Impossible de charger ces factures", response.status);
  }
  return response.json();
}

// trust-api rend deux formes d'erreur : `message` pour une exception Nest,
// `fieldErrors` pour un rejet du ZodValidationPipe (« msisdn attendu au format
// +224XXXXXXXXX », « code attendu à 4 chiffres »). Ces deux-là sont exactement
// ce qu'il faut montrer à l'acheteur.
async function messageDErreur(response: Response, defaut: string): Promise<string> {
  const corps = (await response.json().catch(() => null)) as {
    message?: unknown;
    fieldErrors?: Record<string, unknown>;
  } | null;

  if (corps?.fieldErrors) {
    const details = Object.values(corps.fieldErrors)
      .flatMap((messages) => (Array.isArray(messages) ? messages : [messages]))
      .map(String)
      .join(" · ");
    if (details) return details;
  }
  if (Array.isArray(corps?.message)) return corps.message.join(", ");
  if (typeof corps?.message === "string") return corps.message;
  return defaut;
}

// Mirroir de la forme aplatie retournée par GET /practices/mine
// (practices.service.ts:listMine — practice + role du user connecté).
// Portefeuille de crédits (migration 20260907080000). L'unité est le CENTIME
// GNF, comme partout : 1 crédit = 1 GNF, pas de jeton maison à convertir.
export interface CreditTransactionItem {
  id: string;
  type: string;
  /** Signé : positif à l'achat, négatif à la consommation. */
  amountCentimes: string;
  balanceAfterCentimes: string;
  label: string;
  invoiceId: string | null;
  createdAt: string;
}

export interface CreditWallet {
  balanceCentimes: string;
  transactions: CreditTransactionItem[];
}

export async function getCreditWallet(token: string, organizationId: string): Promise<CreditWallet> {
  const response = await authenticatedFetch(
    `/organizations/${encodeURIComponent(organizationId)}/credits`,
    token,
  );
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger le portefeuille", response.status);
  }
  return response.json();
}

export interface ReferralItem {
  id: string;
  /** Instantané du nom au moment du rattachement — voir Referral dans le
   *  schéma : sous RLS le parrain ne peut pas lire l'organisation du filleul. */
  referredName: string;
  status: "pending" | "converted";
  convertedAt: string | null;
  /** null tant que le filleul n'a pas pris d'abonnement payant. */
  referrerBonusCentimes: string | null;
  createdAt: string;
}

export interface ReferralSummary {
  isActive: boolean;
  referralCode: string | null;
  totalGainsCentimes: string;
  referrals: ReferralItem[];
}

export async function getReferralSummary(
  token: string,
  organizationId: string,
): Promise<ReferralSummary> {
  const response = await authenticatedFetch(
    `/organizations/${encodeURIComponent(organizationId)}/referrals`,
    token,
  );
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger le parrainage", response.status);
  }
  return response.json();
}

/** Idempotent côté API : réactiver rend le code déjà attribué. */
export async function activateReferral(
  token: string,
  organizationId: string,
): Promise<{ referralCode: string }> {
  const response = await authenticatedFetch(
    `/organizations/${encodeURIComponent(organizationId)}/referrals/activate`,
    token,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new TrustApiError("Impossible d'activer le parrainage", response.status);
  }
  return response.json();
}

export async function attachReferral(
  token: string,
  organizationId: string,
  code: string,
): Promise<void> {
  const response = await authenticatedFetch(
    `/organizations/${encodeURIComponent(organizationId)}/referrals/attach`,
    token,
    {
      method: "POST",
      // authenticatedFetch ne pose pas Content-Type : sans lui, Nest ne parse
      // pas le corps et le code arrive vide côté validation.
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    },
  );
  if (!response.ok) {
    // 409 recouvre deux cas distincts et l'API les libelle : déjà rattaché, ou
    // auto-parrainage. On relaie son message plutôt qu'un texte générique.
    const body = await response.json().catch(() => null);
    throw new TrustApiError(
      body?.message ?? "Impossible d'enregistrer ce code",
      response.status,
    );
  }
}

export interface PracticeSummary {
  id: string;
  name: string;
  type: string;
  tier: string;
  role: string;
  // GET /practices/mine recopie la ligne entiere de la practice : ces champs
  // sont bien rendus, ils n'etaient simplement pas declares ici.
  registrationNumber?: string | null;
  ordreVerified?: boolean;
  phone?: string | null;
  email?: string | null;
  revenueShareSettlementMode?: string;
}

export const PARTNER_TIERS = [
  "partner_free",
  "partner_starter",
  "partner_pro",
  "partner_institutional",
] as const;
export type PartnerTier = (typeof PARTNER_TIERS)[number];

export const SETTLEMENT_MODES = ["payout", "subscription_deduction"] as const;
export type SettlementMode = (typeof SETTLEMENT_MODES)[number];

/** POST /practices/:id/partner-tier — self-service, jamais un workflow
 *  d'approbation (H3, ADR-071). practice_admin uniquement, garde côté service. */
export async function upgradePartnerTier(
  token: string,
  practiceId: string,
  tier: PartnerTier,
): Promise<void> {
  const response = await authenticatedFetch(
    `/practices/${encodeURIComponent(practiceId)}/partner-tier`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Changement de palier impossible", response.status);
  }
}

/** POST /practices/:id/revenue-share-settlement-mode — n'affecte JAMAIS un
 *  RevenueShareCredit deja genere, oriente seulement les prochains. */
export async function upgradeSettlementMode(
  token: string,
  practiceId: string,
  mode: SettlementMode,
): Promise<void> {
  const response = await authenticatedFetch(
    `/practices/${encodeURIComponent(practiceId)}/revenue-share-settlement-mode`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Changement de mode impossible", response.status);
  }
}

// Mirroir de GET /practices/:id/revenue-share (revenue-share.service.ts:
// listByPractice). Le partage d'honoraires — la commission d'apporteur du
// cabinet, 10 % plafonnés à 5 000 GNF/mois/client (H4, ADR-071) — était calculé,
// stocké et exposé côté trust-api, mais AUCUN écran ne le lisait : un partenaire
// ne pouvait connaître ce qui lui revenait qu'en interrogeant l'API à la main.
//
// Les montants sont des BigInt côté Prisma, sérialisés en chaîne par le
// BigInt.prototype.toJSON de trust-api/src/main.ts — jamais un number, qui
// perdrait de la précision au-delà de Number.MAX_SAFE_INTEGER. Ils restent donc
// des chaînes ici, comme totalTtc partout ailleurs.
export interface RevenueShareCreditItem {
  id: string;
  organizationId: string;
  /** Format "YYYY-MM". */
  periodMonth: string;
  grossCommissionCentimes: string;
  creditedAmountCentimes: string;
  status: string;
  createdAt: string;
}

/** GET /practices/:id/revenue-share — tout membre actif suffit (consultation).
 *  Rend TOUTES les périodes : le filtrage par mois se fait à l'affichage,
 *  l'endpoint n'accepte aucun paramètre de période. */
export async function listPracticeRevenueShare(
  token: string,
  practiceId: string,
): Promise<RevenueShareCreditItem[]> {
  const response = await authenticatedFetch(
    `/practices/${encodeURIComponent(practiceId)}/revenue-share`,
    token,
  );
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger le partage d'honoraires", response.status);
  }
  return response.json();
}

// Mirroir de GET /practices/:id/partner-subscription/:periodMonth. Vue CALCULÉE
// à la demande, jamais une entité persistée (H3, ADR-071) : ce n'est pas une
// facture d'abonnement, c'est ce qui resterait dû ce mois-ci.
export interface PartnerSubscriptionStatus {
  practiceId: string;
  periodMonth: string;
  tier: string;
  /** `null` sur un palier dont le prix est « sur devis » (institutional) —
   *  distinct de "0", qui voudrait dire « plus rien à payer ». Les deux méritent
   *  une phrase différente à l'écran. */
  amountDueCentimes: string | null;
}

export async function getPartnerSubscriptionStatus(
  token: string,
  practiceId: string,
  periodMonth: string,
): Promise<PartnerSubscriptionStatus> {
  const response = await authenticatedFetch(
    `/practices/${encodeURIComponent(practiceId)}/partner-subscription/${encodeURIComponent(periodMonth)}`,
    token,
  );
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger l'abonnement partenaire", response.status);
  }
  return response.json();
}

export interface CreatePracticeInput {
  name: string;
  type: string;
  /** Facultatif — voir create-practice.dto.ts. Omis, jamais envoyé vide. */
  registrationNumber?: string;
  phone: string;
  email?: string;
}

// Le créateur devient practice_admin de la structure : POST /practices ne prend
// aucun identifiant de membre, il rattache le porteur du token.
export async function createPractice(token: string, input: CreatePracticeInput): Promise<PracticeSummary> {
  const response = await authenticatedFetch("/practices", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
    throw new TrustApiError(message ?? "Création du cabinet impossible", response.status);
  }
  return response.json();
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
  status: string;
  /** Date d'octroi du mandat — null tant qu'il est en attente. */
  grantedAt: string | null;
  expiresAt: string | null;
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

/** POST /practices/:id/members/:userId/revoke — départ d'un collaborateur.
 *  Ce n'est PAS une suppression : la ligne d'appartenance reste, datée. Le
 *  mandat étant accordé à l'entité et jamais à l'individu, ce seul geste coupe
 *  tous ses accès aux clients du cabinet. */
export async function revokePracticeMember(
  token: string,
  practiceId: string,
  memberUserId: string,
): Promise<void> {
  const response = await authenticatedFetch(
    `/practices/${encodeURIComponent(practiceId)}/members/${encodeURIComponent(memberUserId)}/revoke`,
    token,
    { method: "POST" },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Retrait impossible", response.status);
  }
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

export interface OrganizationLookupResult {
  id: string;
  name: string;
}

// Miroir de GET /practices/lookup-organization (Chantier C) — annuaire du
// rattachement de mandat. Ne rend QUE l'identifiant et le nom : le backend ne
// sélectionne rien d'autre, celui qui cherche n'étant pas encore mandaté.
//
// 404 et 403 sont distingués parce qu'ils appellent des gestes différents chez
// le comptable : vérifier le numéro, ou demander l'accès à son administrateur.
// 429 est relayé tel quel — la route est limitée à 5 recherches par minute.
export async function lookupOrganizationByNif(token: string, nif: string): Promise<OrganizationLookupResult> {
  const response = await authenticatedFetch(`/practices/lookup-organization?nif=${encodeURIComponent(nif)}`, token);
  if (response.status === 404) {
    throw new TrustApiError("Aucune organisation ne correspond à ce NIF", 404);
  }
  if (response.status === 429) {
    throw new TrustApiError("Trop de recherches — patientez une minute avant de réessayer", 429);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Recherche indisponible", response.status);
  }
  return response.json();
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

// ─────────────────────────────────────────────────────────────────────────────
// Portail acheteur public (DAF) — J1/J2, ADR-080/088/089.
//
// Ces trois routes sont les SEULES que la console DAF consomme, et elles
// partagent une propriété qu'aucune autre section de ce fichier n'a : leur
// autorisation est entièrement inline dans PublicBuyerPortalService, jamais un
// RolesGuard. Un DAF n'est OrganizationMember d'AUCUNE PME — il agit sur les
// factures d'organisations tierces. Ne jamais leur ajouter un
// organizationId : il n'y en a pas un seul, un tableau de bord « encours
// fournisseurs » agrège par construction plusieurs PME.
// ─────────────────────────────────────────────────────────────────────────────

// Mirroir d'une ligne Invoice rendue par GET /public-buyer/invoices
// (public-buyer-portal.service.ts:listReceivedInvoices). Volontairement
// PARTIEL : seuls les champs réellement rendus par le service et affichés par
// la console sont déclarés. Les montants sont des centimes GNF sérialisés en
// string (BigInt.prototype.toJSON, trust-api/src/main.ts) — jamais un number.
//
// Ce que le service ne renvoie PAS, et qui manque donc à l'écran : le NOM du
// fournisseur émetteur. `findMany` n'inclut aucune relation `organization`, et
// le DAF n'a par ailleurs aucune route pour résoudre un organizationId. La
// console affiche donc la référence marché / bon de commande comme identifiant
// métier. Combler ce manque = un `include` côté trust-api, hors périmètre ici.
export interface PublicBuyerInvoice {
  id: string;
  number: string | null;
  certificationId: string | null;
  status: string;
  disputeStatus: string;
  validatedByAdministration: boolean;
  totalTtc: string;
  amountDue: string;
  issuedAt: string | null;
  cadreFacturation: string;
  referenceMarche: string | null;
  numeroBonCommande: string | null;
  numeroEngagement: string | null;
  // K5, ADR-089 — la seule présence de ce champ vaut créance déjà cédée. Il est
  // la source unique du verrou anti-double-nantissement affiché par la console.
  financedByPartnerId: string | null;
  financedAt: string | null;
}

export interface PublicBuyerInvoiceList {
  invoices: PublicBuyerInvoice[];
  // Somme des amountDue du périmètre (centimes GNF, string). Le service exclut
  // déjà draft et voided — ne jamais recalculer ce total côté web à partir de
  // la page courante, il porte sur l'encours ENTIER, pas sur les 50 lignes.
  outstandingTotal: string;
}

export async function listReceivedInvoices(
  token: string,
  pagination: { take?: number; skip?: number } = {},
): Promise<PublicBuyerInvoiceList> {
  const query = new URLSearchParams();
  if (pagination.take !== undefined) {
    query.set("take", String(pagination.take));
  }
  if (pagination.skip !== undefined) {
    query.set("skip", String(pagination.skip));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await authenticatedFetch(`/public-buyer/invoices${suffix}`, token);
  if (response.status === 403) {
    // Le service répond 403 quand le compte n'est rattaché à AUCUN compte
    // acheteur public — cas d'usage normal (un utilisateur PME qui atterrit
    // sur /daf), jamais une panne. La page le distingue par ce statut.
    throw new TrustApiError("Aucun accès à un compte acheteur public", response.status);
  }
  if (!response.ok) {
    throw new TrustApiError("Impossible de charger les factures reçues", response.status);
  }
  return response.json();
}

// J1 — vise le service fait / liquidation. Idempotent côté service (un second
// appel renvoie 200 sans créer un second InvoiceEvent), donc un double clic est
// sans conséquence ici : le 409 que cette route peut rendre ne concerne que les
// factures draft ou voided, jamais une course entre deux validations.
export async function validateLiquidation(token: string, invoiceId: string): Promise<PublicBuyerInvoice> {
  const response = await authenticatedFetch(
    `/public-buyer/invoices/${encodeURIComponent(invoiceId)}/validate-liquidation`,
    token,
    { method: "POST" },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    // Message de l'API relayé tel quel : il distingue « pas une facture B2G »,
    // « compte non vérifié » et « rattachement non confirmé », trois refus que
    // le DAF doit pouvoir lire. Les reformuler ici les rendrait indistincts.
    throw new TrustApiError(body?.message ?? "Validation impossible", response.status);
  }
  return response.json();
}

// Security Audit 2026-08-23, finding #13 — confirmation par le compte CIBLÉ du
// rattachement qu'une PME a posé unilatéralement. Sans elle, la facture reste
// invisible dans listReceivedInvoices() (isPublicEntityConfirmed: true) : c'est
// donc un prérequis, pas une option, et la console doit l'exposer.
export async function confirmCustomerLink(token: string, customerId: string): Promise<void> {
  const response = await authenticatedFetch(
    `/public-buyer/customers/${encodeURIComponent(customerId)}/confirm-link`,
    token,
    { method: "POST" },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new TrustApiError(body?.message ?? "Confirmation impossible", response.status);
  }
}
