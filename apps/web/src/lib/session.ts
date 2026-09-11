import { cookies } from "next/headers";

// httpOnly cookie posant le JWT RS256 émis par trust-api — jamais localStorage
// (illisible côté Server Component, et un JWT en localStorage est exposé à
// tout XSS). maxAge aligné sur l'expiration réelle du token (12h, voir
// apps/trust-api/src/auth/auth-token.service.ts) : un cookie qui survivrait
// au token laisserait croire à une session valide alors que trust-api
// rejetterait déjà toute requête.
export const SESSION_COOKIE_NAME = "fg_session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

// Lève plutôt que de retourner null — appelé uniquement depuis des pages sous
// /dashboard, déjà protégées par le proxy (un appel ici sans cookie est
// un bug de câblage, pas un cas utilisateur normal à gérer silencieusement.
export async function requireSessionToken(): Promise<string> {
  const token = await getSessionToken();
  if (!token) {
    throw new Error("requireSessionToken() appelé hors d'une route protégée par middleware.ts");
  }
  return token;
}
