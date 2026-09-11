import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session";

// "proxy" — convention Next.js 16 remplaçant "middleware" (renommage pur, même
// mécanisme). Bloque AVANT tout rendu — un layout seul s'exécuterait déjà après
// le début du rendu du segment. Ne vérifie que la PRÉSENCE du cookie (pas sa
// validité JWT — coûteux ici, et trust-api revérifie de toute façon la
// signature à chaque appel authentifié réel) : un cookie présent mais
// expiré/invalide laisse passer jusqu'au premier fetch trust-api, qui échoue
// alors en 401 — géré par chaque page, jamais un accès aux données qui en
// résulterait.
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  // Doit rester aligné sur PROTECTED_PREFIXES (lib/route-protection.ts) :
  // un préfixe absent d'ici n'est JAMAIS gardé, quoi qu'en dise cette liste.
  // route-protection.spec.ts vérifie l'alignement — /onboarding est arrivé
  // dans la liste sans arriver ici, et l'écran s'est cru protégé pour rien.
  matcher: [
    "/dashboard/:path*",
    "/cabinet/:path*",
    "/onboarding/:path*",
    "/nouveau-cabinet/:path*",
    "/daf/:path*",
    "/espace-marchand/:path*",
    "/espace-cabinet/:path*",
  ],
};
