// /onboarding rejoint les préfixes protégés : la création d'organisation
// suppose un compte, et son Server Action appelle POST /organizations avec le
// Bearer du cookie de session. Sans session, l'écran s'afficherait pour finir
// sur une erreur au moment de soumettre.
export const PROTECTED_PREFIXES = ["/dashboard", "/cabinet", "/onboarding"];

// Logique pure isolée du glue Next.js (middleware.ts) pour rester testable sans
// mocker next/server — le runtime edge de middleware.ts, lui, n'est pas testé
// unitairement (trop couplé, voir plan).
export function resolveProtectedRouteRedirect(pathname: string, hasSession: boolean): string | null {
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (isProtected && !hasSession) {
    return "/login";
  }
  return null;
}
