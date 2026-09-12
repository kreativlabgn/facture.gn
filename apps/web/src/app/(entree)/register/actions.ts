"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/session";
import { normalizeMsisdn, validateRegistration, type RegistrationField } from "@/lib/registration";
import { TrustApiError, login, register } from "@/lib/trust-api";
import { destinationInterne } from "@/lib/route-protection";

export type RegisterActionState = {
  error: string;
  fieldErrors?: Partial<Record<RegistrationField, string>>;
  // Renvoyées pour que le formulaire se recharge rempli après une erreur. Le
  // mot de passe n'en fait volontairement pas partie : le retourner le ferait
  // transiter une seconde fois et apparaître dans le HTML de la réponse.
  values?: { name: string; msisdn: string };
} | null;


// Deux appels enchaînés, pas un seul : POST /auth/register ne renvoie que
// { userId }, donc c'est POST /auth/login qui fournit le JWT posé en cookie.
// L'enchaînement est fait ici, côté serveur, pour que le mot de passe ne
// reparte jamais du navigateur une deuxième fois.
export async function registerAction(
  _prevState: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const msisdn = normalizeMsisdn(String(formData.get("msisdn") ?? ""));
  const password = String(formData.get("password") ?? "");
  const returnTo = destinationInterne(String(formData.get("returnTo") ?? ""), "/onboarding");
  const values = { name, msisdn };

  const violations = validateRegistration({ name, msisdn, password });
  if (violations.length > 0) {
    const fieldErrors: Partial<Record<RegistrationField, string>> = {};
    for (const violation of violations) {
      fieldErrors[violation.field] ??= violation.message;
    }
    return { error: "Vérifiez les champs signalés.", fieldErrors, values };
  }

  try {
    await register({ name, msisdn, password });
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message, values };
    }
    return { error: "Inscription temporairement indisponible", values };
  }

  let accessToken: string;
  try {
    ({ accessToken } = await login(msisdn, password));
  } catch {
    // Le compte EXISTE désormais : le dire est la seule réponse honnête. Un
    // « inscription impossible » ferait réessayer l'utilisateur, qui se
    // heurterait alors à un numéro déjà pris sans comprendre pourquoi.
    return {
      error: "Votre compte a bien été créé, mais la connexion automatique a échoué. Connectez-vous depuis /login.",
      values,
    };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });

  // Hors du try/catch, comme loginAction : redirect() lève une erreur interne
  // Next.js qui serait sinon confondue avec un échec.
  redirect(returnTo);
}