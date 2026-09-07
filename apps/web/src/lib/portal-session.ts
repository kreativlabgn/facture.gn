import { cookies } from "next/headers";

// Session du PORTAIL CLIENT (F13, ADR-096), distincte de celle du marchand.
//
// Deux cookies et non un seul, parce que ce sont deux identités qui ne se
// recouvrent pas : `fg_session` porte un token de portée complète obtenu par
// mot de passe ; celui-ci porte un token `scope:"client_portal"` obtenu par
// OTP SMS. Côté trust-api, RolesGuard REJETTE le second sur toute route
// @Roles() et JwtAuthGuard le refuse partout où @AllowClientPortalScope()
// n'est pas posé. Les confondre dans un même cookie ferait donc échouer l'un
// ou l'autre parcours selon qui s'est connecté en dernier.
//
// Un acheteur peut d'ailleurs être aussi commerçant : le même numéro donne
// alors les deux sessions, sans que l'une n'écrase l'autre.
export const PORTAL_COOKIE_NAME = "fg_portal";

// Aligné sur la durée réelle du token (12 h, auth-token.service.ts) : un cookie
// qui survivrait au token laisserait croire à une session valide alors que
// trust-api rejetterait déjà tout appel.
export const PORTAL_MAX_AGE_SECONDS = 12 * 60 * 60;

export async function getPortalToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(PORTAL_COOKIE_NAME)?.value ?? null;
}

export async function setPortalToken(accessToken: string): Promise<void> {
  const store = await cookies();
  store.set(PORTAL_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PORTAL_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function clearPortalToken(): Promise<void> {
  const store = await cookies();
  store.delete(PORTAL_COOKIE_NAME);
}
