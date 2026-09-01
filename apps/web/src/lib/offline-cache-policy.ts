// PWA offline-first — Phase 1 (App Shell + vérification hors-ligne, ADR-118).
//
// Source de vérité PARTAGÉE entre le service worker (`src/sw.ts`) et ses tests :
// quelles navigations le SW a le droit de mettre en cache, et lesquelles sont
// strictement interdites. Module PUR (aucun accès `self` / `caches` / DOM) —
// même rôle que `route-protection.ts` côté middleware.
//
// Règle de sécurité non négociable : une route authentifiée (`/dashboard`,
// `/cabinet`) ou de paiement (`/pay`) ne doit JAMAIS entrer dans le cache du
// service worker (données par utilisateur, lien de paiement vivant). Le test
// `offline-cache-policy.spec.ts` verrouille cet invariant.

export const OFFLINE_SHELL_CACHE = "facturegn-shell-v1";
export const OFFLINE_PAGES_CACHE = "facturegn-pages-v1";

// Fenêtre au-delà de laquelle une page de vérification mise en cache n'est plus
// servie hors-ligne (DAT « autonomie PWA 48h »).
export const OFFLINE_MAX_AGE_SECONDS = 48 * 60 * 60;
export const OFFLINE_PAGES_MAX_ENTRIES = 60;

// Fichier 100 % statique (`apps/web/public/offline.html`) servi quand une
// navigation hors-ligne ne correspond à rien en cache. Précaché automatiquement
// via `globPublicPatterns` de `@serwist/next`.
export const OFFLINE_FALLBACK_PATH = "/offline.html";

// Préfixes de routes jamais mises en cache par le service worker.
const SENSITIVE_PREFIXES = ["/dashboard", "/cabinet", "/pay", "/api", "/_next/data"];

// Premiers segments qui ne peuvent pas être un identifiant de certification —
// routes de l'app ou fichiers servis à la racine.
const RESERVED_TOP_SEGMENTS = new Set([
  "dashboard",
  "cabinet",
  "pay",
  "login",
  "api",
  "_next",
  "manifest.webmanifest",
  "sw.js",
  "favicon.ico",
  "offline.html",
]);

function normalizePathname(pathname: string): string {
  let path = pathname.split("?")[0].split("#")[0];
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}

/** `true` si la navigation touche une route authentifiée ou de paiement. */
export function isSensitiveRoute(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return SENSITIVE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * `true` uniquement pour les navigations PUBLIQUES que le service worker peut
 * mettre en cache : l'accueil, la page de connexion, et une page de vérification
 * `/{certificationId}` (segment unique, non réservé). Tout le reste — routes
 * sensibles, chemins profonds, fichiers réservés — renvoie `false`.
 */
export function isPubliclyCacheableNavigation(pathname: string): boolean {
  const path = normalizePathname(pathname);

  if (isSensitiveRoute(path)) {
    return false;
  }
  if (path === "/" || path === "/login") {
    return true;
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length !== 1) {
    return false;
  }
  return !RESERVED_TOP_SEGMENTS.has(segments[0]);
}
