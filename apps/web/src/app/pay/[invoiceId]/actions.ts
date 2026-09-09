"use server";

import { cookies } from "next/headers";
import { chargeMobileMoney, fetchPublicCheckout, MoneyApiError } from "@/lib/money-api";
import { estOperateurConnu, normaliserMsisdn } from "@/lib/mobile-money";
import { jetonPaiementValide, PAY_COOKIE_NAME } from "@/lib/pay-session";

export type PaiementActionState =
  | null
  | { statut: "erreur"; message: string }
  | {
      statut: "engage";
      /** Ce que le payeur doit faire sur son téléphone, dit par l'opérateur. */
      instruction: string;
      totalDebiteGnf: string;
      msisdn: string;
    };

// Server Action et non un `fetch` depuis le navigateur : MONEY_API_INTERNAL_KEY
// est server-only à dessein (pas de préfixe NEXT_PUBLIC_), et une route qui
// déclenche un débit ne s'expose pas au client. Même règle que les actions du
// portail acheteur — la clé, comme le token OTP, ne doit jamais atteindre du JS
// de navigateur.
export async function initiateMobileMoneyPaymentAction(
  _prev: PaiementActionState,
  formData: FormData,
): Promise<PaiementActionState> {
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  if (!invoiceId) {
    return { statut: "erreur", message: "Facture inconnue. Rouvrez le lien reçu par SMS." };
  }

  // ── Garde 1 : la session de checkout ──────────────────────────────────────
  // `invoiceId` vient d'un champ caché, donc du client, donc modifiable. C'est
  // précisément pourquoi le jeton est signé SUR cet identifiant : changer le
  // champ pour viser une autre facture invalide la signature, et le `path` du
  // cookie fait que le navigateur ne l'enverrait de toute façon pas.
  const store = await cookies();
  if (!(await jetonPaiementValide(invoiceId, store.get(PAY_COOKIE_NAME)?.value))) {
    return {
      statut: "erreur",
      message: "Votre session de paiement a expiré. Rechargez la page pour reprendre.",
    };
  }

  // ── Garde 2 : le numéro ───────────────────────────────────────────────────
  const numero = normaliserMsisdn(String(formData.get("msisdn") ?? ""));
  if (!numero.ok) {
    return { statut: "erreur", message: numero.erreur };
  }

  const operator = String(formData.get("operator") ?? "");
  if (!estOperateurConnu(operator)) {
    return { statut: "erreur", message: "Choisissez Orange Money ou MTN MoMo." };
  }

  // ── Garde 3 : l'état de la facture, relu MAINTENANT ───────────────────────
  // L'écran a déjà masqué le formulaire sur une facture non payable, mais entre
  // le rendu de la page et ce clic, la facture a pu être réglée en espèces,
  // annulée, ou contestée. money-api revérifiera de son côté (c'est lui qui
  // fait autorité) ; cette lecture-ci sert à donner au payeur la VRAIE raison
  // plutôt qu'un échec sec au retour du gateway.
  let checkout;
  try {
    checkout = await fetchPublicCheckout(invoiceId);
  } catch {
    return {
      statut: "erreur",
      message: "Paiement momentanément indisponible. Réessayez dans un instant.",
    };
  }
  if (!checkout) {
    return { statut: "erreur", message: "Ce lien de paiement n'est plus valide." };
  }
  if (!checkout.payable) {
    return {
      statut: "erreur",
      message: checkout.messageRefus ?? "Cette facture ne peut pas être réglée en ligne.",
    };
  }

  // ── Le débit ──────────────────────────────────────────────────────────────
  try {
    const charge = await chargeMobileMoney(invoiceId, numero.msisdn, operator);
    return {
      statut: "engage",
      instruction: charge.instruction,
      totalDebiteGnf: charge.totalDebiteGnf,
      msisdn: numero.msisdn,
    };
  } catch (error) {
    if (error instanceof MoneyApiError) {
      // Le message vient de money-api et est déjà écrit pour le payeur (facture
      // déjà réglée, débit en vol, opérateur indisponible).
      return { statut: "erreur", message: error.message };
    }
    return {
      statut: "erreur",
      message: "Le paiement n'a pas pu être lancé. Réessayez dans un instant.",
    };
  }
}

// PAS de revalidatePath ici, et c'est voulu : rien n'a encore changé côté
// serveur. Le débit est `pending` — la facture ne passera à `paid` qu'au retour
// du webhook, et rafraîchir l'écran maintenant afficherait exactement les mêmes
// montants en laissant croire que quelque chose a été acté.
