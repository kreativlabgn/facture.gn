"use server";

import { redirect } from "next/navigation";
import { setPortalToken } from "@/lib/portal-session";
import { requestPortalOtp, TrustApiError, verifyPortalOtp } from "@/lib/trust-api";

export type OtpActionState = { error: string } | { envoye: string } | null;

// Server Actions et non des `fetch` depuis le navigateur : TRUST_API_URL n'a
// pas le préfixe NEXT_PUBLIC_ (server-only à dessein), et surtout le token
// rendu par l'OTP ne doit jamais atteindre du JS client. C'est la même règle
// que loginAction — « un JWT en localStorage est exposé à tout XSS », et le
// garder dans un state React ne vaut pas mieux.

export async function requestOtpAction(
  _prev: OtpActionState,
  formData: FormData,
): Promise<OtpActionState> {
  const msisdn = String(formData.get("msisdn") ?? "").trim();
  if (!msisdn) {
    return { error: "Entrez votre numéro de téléphone." };
  }

  try {
    // L'OTP porte sur le NUMÉRO, jamais sur une facture : trust-api ne connaît
    // pas de code lié à un document (client-portal/dto/request-otp.dto.ts).
    await requestPortalOtp(msisdn);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Envoi du code temporairement indisponible." };
  }

  return { envoye: msisdn };
}

// `retour` est confiné aux chemins internes du portail : une valeur venue du
// formulaire ne doit jamais pouvoir devenir une redirection ouverte vers un
// domaine tiers. Tout ce qui ne commence pas par « /portail/ » retombe sur
// l'accueil.
function destination(brut: string): string {
  return brut.startsWith("/portail/") && !brut.startsWith("//") ? brut : "/portail";
}

export async function verifyOtpAction(
  _prev: OtpActionState,
  formData: FormData,
): Promise<OtpActionState> {
  const msisdn = String(formData.get("msisdn") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const retour = destination(String(formData.get("retour") ?? ""));

  if (!msisdn || !code) {
    return { error: "Entrez le code reçu par SMS." };
  }

  try {
    const { accessToken } = await verifyPortalOtp(msisdn, code);
    await setPortalToken(accessToken);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Vérification temporairement indisponible." };
  }

  // Hors du try/catch : redirect() lève une erreur interne à Next, que le catch
  // ci-dessus prendrait pour un échec de vérification.
  redirect(retour);
}
