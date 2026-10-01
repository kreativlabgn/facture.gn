// /onboarding rejoint les préfixes protégés : la création d'organisation
// suppose un compte, et son Server Action appelle POST /organizations avec le
// Bearer du cookie de session. Sans session, l'écran s'afficherait pour finir
// sur une erreur au moment de soumettre.
// /daf — console de l'acheteur public. Route de premier niveau au même titre
// que /cabinet : son occupant n'est membre d'aucune organisation PME, ni
// /dashboard ni /cabinet ne le concerne.
export const PROTECTED_PREFIXES = ["/dashboard", "/cabinet", "/onboarding", "/nouveau-cabinet", "/daf", "/demo", "/admin"];

// Point d'ancrage local fictif : new URL() résout `value` exactement comme le
// ferait un navigateur (contre-oblique normalisée en séparateur de chemin,
// tabulations/retours ignorés, hôte alternatif détecté) sans réimplémenter
// cette normalisation à la main — l'ancienne version en regex ne bloquait que
// la contre-oblique littérale et aurait laissé passer une variante comme
// « /\t/evil.com » (tabulation strippée par l'algorithme d'analyse d'URL,
// donc équivalente à « //evil.com » une fois résolue). La contre-oblique
// reste en plus rejetée d'entrée, explicitement.
const ANCRAGE_LOCAL = "http://facture-gn.internal";

export function destinationInterne(value: string, fallback = "/dashboard"): string {
  if (!value.startsWith("/") || value.includes("\\")) {
    return fallback;
  }
  try {
    return new URL(value, ANCRAGE_LOCAL).origin === ANCRAGE_LOCAL ? value : fallback;
  } catch {
    return fallback;
  }
}

// Logique pure isolée du glue Next.js (middleware.ts) pour rester testable sans
// mocker next/server — le runtime edge du proxy Next.js, lui, n'est pas testé
// unitairement (trop couplé, voir plan).
export function resolveProtectedRouteRedirect(pathname: string, hasSession: boolean): string | null {
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (isProtected && !hasSession) {
    return "/login";
  }
  return null;
}
