// Navigation et règles d'accès de l'espace cabinet (Chantier C).
//
// Même discipline que nav.ts et permissions.ts : les règles du backend sont
// RECOPIÉES ici, jamais réinventées. Côté trust-api, `assertPracticeAdmin`
// (common/rbac/practice-access.ts) est le seul garde qui compte — celles-ci ne
// font que masquer ce qui serait de toute façon refusé, pour ne pas offrir un
// bouton qui mène à un 403.

export interface CabinetNavEntry {
  href: string;
  label: string;
}

// Les URL restent en anglais, comme tout le reste du dépôt (/dashboard/customers,
// /cabinet/mandates). L'interface, elle, est en français.
export const CABINET_NAV: readonly CabinetNavEntry[] = [
  { href: "/cabinet", label: "Organisations" },
  { href: "/cabinet/mandates", label: "Mandats" },
  { href: "/cabinet/members", label: "Collaborateurs" },
];

export const PRACTICE_ROLES = ["practice_admin", "accountant_external", "business_manager"] as const;
export type PracticeRole = (typeof PRACTICE_ROLES)[number];

export const PRACTICE_ROLE_LABELS: Record<PracticeRole, string> = {
  practice_admin: "Administrateur du cabinet",
  accountant_external: "Comptable externe",
  business_manager: "Gestionnaire d'affaires",
};

export const PRACTICE_TYPE_LABELS: Record<string, string> = {
  cabinet_comptable: "Cabinet comptable",
  gestionnaire: "Gestionnaire",
  fiduciaire: "Fiduciaire",
  cga: "CGA",
};

export function practiceRoleLabel(role: string): string {
  return PRACTICE_ROLE_LABELS[role as PracticeRole] ?? role;
}

// Miroir d'assertPracticeAdmin : demander ou révoquer un mandat engage le
// cabinet vis-à-vis d'une organisation cliente. Réservé à practice_admin.
export function canManageMandates(role: string): boolean {
  return role === "practice_admin";
}

// Miroir d'assertPracticeAdmin sur PracticesService.inviteMember. Consulter la
// liste des collaborateurs reste ouvert à tout membre actif (le service ne
// vérifie que l'appartenance) — c'est l'INVITATION qui est administrative.
export function canInviteMembers(role: string): boolean {
  return role === "practice_admin";
}

// `/cabinet` est un préfixe de toutes les autres entrées : sans égalité stricte
// pour la racine, « Organisations » resterait actif sur /cabinet/mandates et
// deux entrées seraient annoncées `aria-current` en même temps.
export function isCabinetNavActive(pathname: string, href: string): boolean {
  if (href === "/cabinet") {
    return pathname === "/cabinet";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
