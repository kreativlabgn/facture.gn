import { hasPermission, shellVariantFor, type Permission } from "./permissions";

// Structure de navigation de la coquille ADR-095 : une barre d'onglets basse
// (Accueil · Factures · [+ Émettre] · Clients · Plus) et un tiroir « Plus »
// pour tout le reste. Logique PURE, sans JSX ni next/navigation — c'est ce qui
// la rend testable sans monter un rendu, et c'est là que vivent les décisions
// (quel onglet pour quel rôle, quel onglet est actif), pas dans les composants.

export interface NavEntry {
  href: string;
  label: string;
  // Permission requise pour que l'entrée apparaisse. `null` = visible pour tout
  // membre. Voir permissions.ts : masquer n'autorise rien, trust-api reste seul
  // juge — une entrée affichée à tort mène à un 403, pas à une fuite.
  permission: Permission | null;
}

// L'accueil liste les factures récentes : sans invoices:read il n'a rien à
// montrer et l'API répondrait 403. Il est donc gaté comme les autres — un rôle
// qui n'a aucun onglet (delivery_driver aujourd'hui) est un cas explicite,
// traité par NavGate, pas une page cassée.
export const PRIMARY_TABS: readonly NavEntry[] = [
  { href: "/dashboard", label: "Accueil", permission: "invoices:read" },
  { href: "/dashboard/invoices", label: "Factures", permission: "invoices:read" },
  { href: "/dashboard/customers", label: "Clients", permission: "customers:read" },
];

// Le FAB « + Émettre » n'est pas un onglet : c'est l'action centrale de la
// barre, posée entre les onglets et surélevée (maquette consolidée). Il ne
// s'allume jamais comme un onglet — on n'« est » pas dans Émettre, on y va.
export const EMIT_ACTION: NavEntry = {
  href: "/dashboard/invoices/new",
  label: "Émettre",
  permission: "invoices:create",
};

// Tiroir « Plus ». La déconnexion et l'espace cabinet n'y figurent pas : la
// première est une action (pas une route), le second ne dépend pas d'un rôle
// d'organisation mais de l'appartenance à un cabinet — les deux sont posés
// directement par MoreDrawer.
export const MORE_ENTRIES: readonly NavEntry[] = [
  { href: "/dashboard/products", label: "Produits", permission: "products:read" },
  { href: "/dashboard/settings", label: "Paramètres", permission: "organization:read" },
];

// En variante « lite » (terrain — voir shellVariantFor), l'onglet Factures
// disparaît : l'accueil affiche déjà la liste des factures récentes, et sur un
// écran tenu à une main quatre cibles valent mieux que cinq. Ce n'est pas un
// retrait de droit — le rôle garde invoices:read et l'accueil le lui sert.
const LITE_HIDDEN_HREFS: readonly string[] = ["/dashboard/invoices"];

export function visibleTabs(role: string): NavEntry[] {
  const lite = shellVariantFor(role) === "lite";
  return PRIMARY_TABS.filter(
    (entry) =>
      (entry.permission === null || hasPermission(role, entry.permission)) &&
      !(lite && LITE_HIDDEN_HREFS.includes(entry.href)),
  );
}

export function visibleMoreEntries(role: string): NavEntry[] {
  return MORE_ENTRIES.filter((entry) => entry.permission === null || hasPermission(role, entry.permission));
}

export function canEmit(role: string): boolean {
  return EMIT_ACTION.permission === null || hasPermission(role, EMIT_ACTION.permission);
}

// Un rôle sans aucun onglet ET sans action d'émission n'a rien à faire dans la
// coquille — aujourd'hui c'est le cas de delivery_driver, dont la seule
// permission (payments:record) n'a pas encore d'écran web. NavGate s'en sert
// pour afficher un état dédié plutôt qu'une coquille vide.
export function hasAnyShellScreen(role: string): boolean {
  return visibleTabs(role).length > 0 || canEmit(role) || visibleMoreEntries(role).length > 0;
}

const ALL_HREFS: readonly string[] = [...PRIMARY_TABS, EMIT_ACTION, ...MORE_ENTRIES].map((entry) => entry.href);

// Le plus long href qui préfixe le chemin gagne. Cette règle évite les cas
// tordus sans table d'exceptions : /dashboard/invoices/new appartient à
// « Émettre » et non à « Factures », /dashboard/customers/<id> reste sur
// « Clients », et /dashboard n'attrape pas tout le reste au passage.
export function activeHref(pathname: string): string | null {
  const matches = ALL_HREFS.filter((href) => pathname === href || pathname.startsWith(`${href}/`));
  if (matches.length === 0) {
    return null;
  }
  return matches.reduce((longest, href) => (href.length > longest.length ? href : longest));
}

export function isTabActive(pathname: string, href: string): boolean {
  return activeHref(pathname) === href;
}

// Vrai quand le chemin courant est servi par une entrée du tiroir — le bouton
// « Plus » s'allume alors comme un onglet, sinon l'utilisateur perd de vue où
// il se trouve dès qu'il ouvre Produits ou Paramètres.
export function isMoreActive(pathname: string, role: string): boolean {
  const active = activeHref(pathname);
  return active !== null && visibleMoreEntries(role).some((entry) => entry.href === active);
}
