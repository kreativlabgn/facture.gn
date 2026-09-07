// Miroir CÔTÉ AFFICHAGE des décorateurs @Roles() de trust-api. Ce fichier ne
// protège rien : il décide seulement ce qu'on MONTRE. L'autorisation réelle
// reste entièrement côté trust-api (RolesGuard + OrganizationAccessService),
// qui revérifie chaque appel — un utilisateur qui forcerait l'URL d'un écran
// masqué se prendrait un 403 de l'API, pas une page de données.
//
// La règle de mise à jour : quand un @Roles() bouge côté trust-api, il bouge
// ici. Chaque entrée cite le controller qu'elle recopie pour que la
// divergence se voie à la relecture. Une divergence n'est pas un trou de
// sécurité — c'est un écran proposé qui finira en 403, ou un écran caché à
// quelqu'un qui y a droit.

export const ORGANIZATION_ROLES = [
  "owner",
  "admin",
  "accountant_internal",
  "cashier",
  "field_agent",
  "delivery_driver",
  "client_portal",
  "auditor",
  "approver",
  "tax_controller_readonly",
  "developer_api",
  "inventory_manager",
  "viewer",
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export type Permission =
  | "invoices:read"
  | "invoices:create"
  | "invoices:issue"
  | "invoices:void"
  | "invoices:relance"
  | "customers:read"
  | "customers:create"
  | "customers:merge"
  | "products:read"
  | "organization:read"
  | "organization:trust_score"
  | "payments:record";

const PERMISSION_ROLES: Record<Permission, readonly OrganizationRole[]> = {
  // invoices.controller.ts — GET /invoices, GET /invoices/:id
  "invoices:read": ["owner", "admin", "accountant_internal", "cashier", "field_agent", "tax_controller_readonly", "viewer"],
  // invoices.controller.ts — POST /invoices. delivery_driver en est absent :
  // il encaisse, il n'émet pas.
  "invoices:create": ["owner", "admin", "accountant_internal", "cashier", "field_agent"],
  // invoices.controller.ts — POST /invoices/:id/issue. Trio PLUS ÉTROIT que
  // invoices:create : accountant_internal et field_agent peuvent préparer un
  // brouillon, pas le certifier. L'émission scelle le hash et consomme un
  // numéro de séquence légal — elle est irréversible.
  "invoices:issue": ["owner", "admin", "cashier"],
  // invoices.controller.ts — POST /invoices/:id/void. Le plus étroit des trois :
  // annuler une facture émise touche la séquence légale.
  "invoices:void": ["owner", "admin"],
  // invoices.controller.ts — POST /invoices/:id/send-reminder et
  // /regenerate-payment-link. Deux routes, même trio, même geste métier :
  // relancer un client qui n'a pas payé.
  "invoices:relance": ["owner", "admin", "cashier"],
  // customers.controller.ts — GET /customers, GET /customers/:id
  "customers:read": ["owner", "admin", "accountant_internal", "cashier", "field_agent"],
  // customers.controller.ts — POST /customers
  "customers:create": ["owner", "admin", "accountant_internal", "cashier", "field_agent"],
  // customers.controller.ts — POST /customers/:id/merge, E4/ADR-038 :
  // "admin/owner uniquement, jamais cashier ni field_agent" (fusion
  // irréversible). Le palier commercial est vérifié EN PLUS côté trust-api
  // (isAdvancedCustomerManagementAllowed) — non modélisé ici, l'API reste seule
  // juge et son message d'erreur est déjà explicite.
  "customers:merge": ["owner", "admin"],
  // products.controller.ts — tout le controller est owner/admin, y compris la
  // simple lecture (cost_price, territoire business_manager d'ADR-084).
  "products:read": ["owner", "admin"],
  // organizations.controller.ts — GET /organizations/:id
  "organization:read": ["owner", "admin"],
  // organizations.controller.ts — GET /organizations/:id/trust-score (E8)
  "organization:trust_score": ["owner", "admin"],
  // payments.controller.ts — POST /payments, /deposit, /bank-transfer. Aucun
  // écran web ne consomme encore ces routes (voir nav.ts) ; la permission est
  // modélisée parce que c'est la SEULE que delivery_driver possède, et que
  // c'est ce qui explique la variante « lite ».
  "payments:record": ["owner", "admin", "cashier", "field_agent", "delivery_driver"],
};

// `role` arrive en string brut de l'API (OrganizationSummary.role) — jamais
// typé à la source, et un rôle ajouté côté trust-api avant d'être connu ici
// doit se comporter comme « aucune permission », pas provoquer un crash.
export function hasPermission(role: string, permission: Permission): boolean {
  return (PERMISSION_ROLES[permission] as readonly string[]).includes(role);
}

export function permissionsFor(role: string): Permission[] {
  return (Object.keys(PERMISSION_ROLES) as Permission[]).filter((permission) => hasPermission(role, permission));
}

// Terrain (field_agent, delivery_driver) : ces deux rôles travaillent debout,
// sur un téléphone d'entrée de gamme, souvent hors connexion — la coquille
// leur présente moins d'onglets et des cibles plus grandes (voir nav.ts et
// BottomTabBar). Ce n'est PAS une histoire de permissions : un cashier a
// presque les mêmes droits qu'un field_agent et garde la coquille complète.
const LITE_SHELL_ROLES: readonly string[] = ["field_agent", "delivery_driver"];

export type ShellVariant = "full" | "lite";

export function shellVariantFor(role: string): ShellVariant {
  return LITE_SHELL_ROLES.includes(role) ? "lite" : "full";
}

// Libellés français des rôles — affichés par OrgSwitcher et l'en-tête. Un rôle
// inconnu retombe sur sa valeur brute plutôt que sur un tiret : mieux vaut un
// identifiant technique lisible qu'une information effacée.
const ROLE_LABELS: Record<string, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  accountant_internal: "Comptable interne",
  cashier: "Caissier",
  field_agent: "Agent terrain",
  delivery_driver: "Livreur",
  client_portal: "Portail client",
  auditor: "Auditeur",
  approver: "Approbateur",
  tax_controller_readonly: "Contrôleur fiscal (lecture)",
  developer_api: "Développeur API",
  inventory_manager: "Gestionnaire de stock",
  viewer: "Proche / assistant",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
