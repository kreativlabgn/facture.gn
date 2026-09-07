"use server";

import { revalidatePath } from "next/cache";
import { requireSessionToken } from "@/lib/session";
import {
  issueInvoice,
  regeneratePaymentLink,
  sendInvoiceReminder,
  TrustApiError,
  voidInvoice,
} from "@/lib/trust-api";

export type InvoiceActionState = { error: string } | { ok: string } | null;

// Les quatre actions de l'écran détail. Chacune relaie le message de trust-api
// tel quel : il est déjà écrit pour être lu par un commerçant (« Une facture
// avec un paiement enregistré ne peut être annulée — utiliser un avoir »), et
// le remplacer par un texte générique perdrait la seule explication utile.
//
// Aucune n'implémente de contrôle de rôle : RolesGuard tranche côté trust-api,
// et un 403 remonte ici comme n'importe quelle autre erreur. Le masquage des
// boutons côté page est du confort, jamais la barrière.
async function executer(
  invoiceId: string,
  succes: string,
  operation: (token: string, id: string) => Promise<unknown>,
): Promise<InvoiceActionState> {
  if (!invoiceId) {
    return { error: "Action impossible : identifiant de facture manquant" };
  }

  const token = await requireSessionToken();
  try {
    await operation(token, invoiceId);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Action temporairement indisponible" };
  }

  // La liste affiche le statut et le montant : les deux peuvent changer ici.
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  revalidatePath("/dashboard/invoices");
  revalidatePath("/dashboard");

  return { ok: succes };
}

// L'émission scelle le hash et consomme un numéro de séquence légal — elle est
// IRRÉVERSIBLE. Le geste de confirmation appartient au composant client, jamais
// à cette action : elle applique ce qu'on lui demande.
export async function issueInvoiceAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  return executer(
    String(formData.get("invoiceId") ?? "").trim(),
    "Facture émise et certifiée.",
    issueInvoice,
  );
}

export async function voidInvoiceAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  // Défense en profondeur : le bouton est déjà désactivé tant que la case n'est
  // pas cochée, revérifié ici parce qu'un POST peut être rejoué sans passer par
  // le JS du navigateur. Même discipline que mergeCustomerAction.
  if (formData.get("confirmed") !== "on") {
    return { error: "Vous devez confirmer l'annulation avant de continuer" };
  }
  return executer(invoiceId, "Facture annulée.", voidInvoice);
}

export async function sendReminderAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  return executer(
    String(formData.get("invoiceId") ?? "").trim(),
    "Relance envoyée au client.",
    sendInvoiceReminder,
  );
}

export async function regeneratePaymentLinkAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  return executer(
    String(formData.get("invoiceId") ?? "").trim(),
    "Nouveau lien de paiement généré.",
    regeneratePaymentLink,
  );
}
