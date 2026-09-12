import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import {
  cheminCookiePaiement,
  creerJetonPaiement,
  jetonPaiementValide,
  PAY_COOKIE_NAME,
  PAY_TTL_SECONDS,
} from "@/lib/pay-session";

// "proxy" — convention Next.js 16 remplaçant "middleware" (renommage pur, même
// mécanisme). Bloque AVANT tout rendu — un layout seul s'exécuterait déjà après
// le début du rendu du segment. Ne vérifie que la PRÉSENCE du cookie (pas sa
// validité JWT — coûteux ici, et trust-api revérifie de toute façon la
// signature à chaque appel authentifié réel) : un cookie présent mais
// expiré/invalide laisse passer jusqu'au premier fetch trust-api, qui échoue
// alors en 401 — géré par chaque page, jamais un accès aux données qui en
// résulterait.
//
// Chantier 3 — /pay/[invoiceId] s'y ajoute pour une tout autre raison : rien
// n'y est protégé, on y OUVRE au contraire une session de checkout éphémère.
// C'est le seul endroit où poser ce cookie : un Server Component ne peut pas
// écrire de cookie pendant son rendu, et le faire depuis la Server Action
// arriverait trop tard — elle est justement ce qu'il sert à autoriser.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/pay/")) {
    return ouvrirSessionPaiement(request, pathname);
  }

  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

async function ouvrirSessionPaiement(request: NextRequest, pathname: string) {
  const response = NextResponse.next();

  // "/pay/<id>" → l'identifiant est le troisième segment. Une URL plus profonde
  // n'est pas un checkout : on la laisse filer sans jeton plutôt que d'en
  // signer un pour un identifiant qui n'en est pas un.
  const segments = pathname.split("/");
  const invoiceId = segments.length === 3 ? decodeURIComponent(segments[2]) : "";
  if (!invoiceId) {
    return response;
  }

  try {
    // Un jeton encore valide n'est pas remplacé : le renouveler à chaque
    // rechargement en ferait une session glissante sans fin, là où la borne des
    // 15 minutes est précisément ce qu'on veut tenir.
    if (await jetonPaiementValide(invoiceId, request.cookies.get(PAY_COOKIE_NAME)?.value)) {
      return response;
    }

    response.cookies.set(PAY_COOKIE_NAME, await creerJetonPaiement(invoiceId), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // `strict` et non `lax` : ce cookie n'a aucune raison d'accompagner une
      // navigation venue d'ailleurs. Le lien reçu par SMS ouvre bien la page —
      // c'est la réponse à ce premier GET qui pose le cookie, et la Server
      // Action qui suit part de la page elle-même, donc en same-site.
      sameSite: "strict",
      maxAge: PAY_TTL_SECONDS,
      path: cheminCookiePaiement(invoiceId),
    });
  } catch (error) {
    // PAY_SESSION_SECRET absent ou trop court. On laisse la page s'afficher
    // (le payeur a le droit de voir ce qu'on lui réclame) mais sans jeton :
    // la Server Action refusera le débit. Panne fermée et tracée, jamais un
    // paiement qui part sans session valide.
    console.error("Session de paiement non ouverte :", error);
  }

  return response;
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
    // ADR-123 — démonstrations commerciales habillées par la coquille (app).
    "/demo/:path*",
    // Chantier 3 — pas une route protégée : ouverture de la session de checkout.
    "/pay/:path*",
  ],
};
