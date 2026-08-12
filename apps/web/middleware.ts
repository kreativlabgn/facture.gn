import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { resolveProtectedRouteRedirect } from "@/lib/route-protection";

// Comble le gap documenté dans session.ts:requireSessionToken() — les pages
// sous /dashboard et /cabinet supposaient déjà être protégées par ce fichier,
// qui n'existait pas (voir docs/plans/2026-08-12-dashboard-web-middleware.md).
// Vérifie uniquement la PRÉSENCE du cookie, jamais la validité du JWT
// lui-même — trust-api revérifie déjà strictement la signature/expiration à
// chaque appel API (voir le plan pour la justification de ce scope réduit).
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  const redirectPath = resolveProtectedRouteRedirect(request.nextUrl.pathname, hasSession);

  if (redirectPath) {
    return NextResponse.redirect(new URL(redirectPath, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/cabinet/:path*"],
};
