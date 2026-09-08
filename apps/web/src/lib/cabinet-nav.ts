// Navigation et règles d'accès de l'espace cabinet (Chantier C).
//
// Même discipline que nav.ts et permissions.ts : les règles du backend sont
// RECOPIÉES ici, jamais réinventées. Côté trust-api, `assertPracticeAdmin`
// (common/rbac/practice-access.ts) est le seul garde qui compte — celles-ci ne
// font que masquer ce qui serait de toute façon refusé, pour ne pas offrir un
// bouton qui mène à un 403.

export type CabinetIconName = "overview" | "clients" | "mandate" | "team" | "practice";

export interface CabinetNavEntry {
  href: string;
  label: string;
  icon: CabinetIconName;
  /** Vrai si l'entrée n'est utile qu'à un practice_admin. Masquer n'autorise
   *  rien : trust-api refuse de toute façon, c'est pour ne pas offrir un bouton
   *  qui mène à un 403. */
  adminOnly?: boolean;
}

export interface CabinetNavGroup {
  /** Intitulé du groupe. `null` pour le premier, qui n'a pas à s'annoncer. */
  title: string | null;
  entries: readonly CabinetNavEntry[];
}

// Trois groupes qui répondent aux trois questions d'un cabinet : qui je suis
// (pilotage), pour qui je travaille (portefeuille), avec qui et sous quel toit
// (structure). Grouper plutôt qu'aligner huit entrées à plat : passé cinq
// éléments, une liste sans titre se relit à chaque visite.
//
// Les URL restent en anglais, comme tout le reste du dépôt
// (/dashboard/customers, /cabinet/mandates). L'interface, elle, est en français.
export const CABINET_NAV_GROUPS: readonly CabinetNavGroup[] = [
  {
    title: null,
    entries: [{ href: "/cabinet", label: "Vue d'ensemble", icon: "overview" }],
  },
  {
    title: "Portefeuille",
    entries: [
      { href: "/cabinet/organizations", label: "Entreprises suivies", icon: "clients" },
      { href: "/cabinet/mandates", label: "Mandats", icon: "mandate" },
    ],
  },
  {
    title: "Le cabinet",
    entries: [
      { href: "/cabinet/members", label: "Collaborateurs", icon: "team" },
      { href: "/cabinet/settings", label: "Paramètres", icon: "practice", adminOnly: true },
    ],
  },
];

/** Aplati, dans l'ordre d'affichage. Sert à résoudre l'entrée active et le
 *  titre de la page — jamais à rendre la navigation, qui a besoin des groupes. */
export const CABINET_NAV: readonly CabinetNavEntry[] = CABINET_NAV_GROUPS.flatMap(
  (groupe) => groupe.entries,
);

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

// Miroir d'assertPracticeAdmin sur upgradePartnerTier /
// upgradeRevenueShareSettlementMode : le palier partenaire et le mode de
// reversement sont les conditions commerciales du cabinet.
export function canManagePractice(role: string): boolean {
  return role === "practice_admin";
}

/** Les groupes tels qu'ils doivent être rendus pour ce rôle. Un groupe dont
 *  toutes les entrées sont masquées disparaît — un titre seul, sans rien
 *  dessous, ressemble à un écran cassé. */
export function visibleCabinetGroups(role: string): CabinetNavGroup[] {
  return CABINET_NAV_GROUPS.map((groupe) => ({
    ...groupe,
    entries: groupe.entries.filter((entree) => !entree.adminOnly || canManagePractice(role)),
  })).filter((groupe) => groupe.entries.length > 0);
}

// `/cabinet` est un préfixe de toutes les autres entrées : sans égalité stricte
// pour la racine, « Vue d'ensemble » resterait actif sur /cabinet/mandates et
// deux entrées seraient annoncées `aria-current` en même temps.
export function isCabinetNavActive(pathname: string, href: string): boolean {
  if (href === "/cabinet") {
    return pathname === "/cabinet";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Le titre affiché dans la barre du haut. L'entrée la plus SPÉCIFIQUE gagne —
 *  même règle qu'activeHref dans nav.ts : sans elle, /cabinet attraperait tout
 *  le reste, chaque sous-page s'annonçant « Vue d'ensemble ». */
export function cabinetPageTitle(pathname: string): string | null {
  const correspondances = CABINET_NAV.filter((entree) => isCabinetNavActive(pathname, entree.href));
  if (correspondances.length === 0) {
    return null;
  }
  return correspondances.reduce((plusLongue, entree) =>
    entree.href.length > plusLongue.href.length ? entree : plusLongue,
  ).label;
}
