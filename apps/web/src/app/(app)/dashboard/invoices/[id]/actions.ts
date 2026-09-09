"use server";

import { revalidatePath } from "next/cache";
import { DISBURSEMENT_METHODS } from "@/lib/financing";
import { requireSessionToken } from "@/lib/session";
import {
  chooseFinancing,
  createCreditNote,
  issueInvoice,
  regeneratePaymentLink,
  sendInvoiceReminder,
  TrustApiError,
  voidInvoice,
  type DisbursementMethod,
} from "@/lib/trust-api";

export type InvoiceActionState = { error: string } | { ok: string } | null;

// L'arbitrage de financement a besoin d'un état PLUS RICHE que les quatre
// autres actions : un refus de concurrence (409) n'est pas une erreur que le
// commerçant doit relire et corriger, c'est un fait acquis — quelqu'un a cédé
// la créance avant lui, éventuellement lui-même au clic précédent. Le drapeau
// permet au composant de basculer sur la confirmation au lieu d'afficher un
// message rouge sous un formulaire devenu caduc.
export type FinancingActionState = { error: string; conflit: boolean } | { ok: string } | null;

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

// ── ARBITRAGE DU RAIL DE FINANCEMENT — ADR-088/089, K4/K5 ───────────────────
//
// LE geste irréversible de cet écran, plus lourd encore que l'annulation : il
// vend une créance à un tiers. K5 pose que la seule présence de
// `financed_by_partner_id` bloque définitivement tout second financement — il
// n'existe aucune route pour défaire une cession, ni ici ni côté trust-api.
//
// Le contrôle de concurrence est ENTIÈREMENT côté serveur, et c'est voulu :
// `chooseFinancing()` revendique la facture par un `updateMany` dont la clause
// `where` rejoue les cinq conditions d'is_financeable(). Deux requêtes
// simultanées entrent toutes les deux, une seule voit `count === 1` ; l'autre
// reçoit un 409 et aucun second InvoiceEvent n'est écrit. Rien à sérialiser
// ici : un verrou côté web ne protégerait que d'un double clic dans UN
// navigateur, jamais de deux onglets, deux téléphones ou deux associés.
//
// NOTE — le cahier des charges demandait d'intercepter `P2002` pour le
// convertir en 409. Ce code n'a pas lieu d'être ici, pour deux raisons
// vérifiées dans le dépôt : `apps/web` n'a aucune dépendance Prisma (il ne
// parle à la base que via trust-api), et `invoice.financed_by_partner_id` ne
// porte AUCUN index unique — seulement une clé étrangère
// (20260819140000_add_financial_partner). Une collision d'unicité ne peut donc
// pas se produire : le 409 vient de la clause `where` de l'updateMany, pas de
// Postgres. C'est ce 409-là qui est intercepté ci-dessous.
export async function chooseFinancingAction(
  _prev: FinancingActionState,
  formData: FormData,
): Promise<FinancingActionState> {
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  if (!invoiceId) {
    return { error: "Action impossible : identifiant de facture manquant", conflit: false };
  }

  const financialPartnerId = String(formData.get("financialPartnerId") ?? "").trim();
  if (!financialPartnerId) {
    return { error: "Choisissez l'établissement financier qui rachète la créance", conflit: false };
  }

  // Revalidé serveur, pas seulement contraint par le <select> : un POST peut
  // être rejoué sans passer par le JS du navigateur. Le DTO zod de trust-api
  // refuserait de toute façon une valeur hors énumération — mais par un 400
  // dont le message parle de schéma, pas au commerçant. Même discipline que la
  // case de confirmation de voidInvoiceAction.
  const methode = String(formData.get("disbursementMethod") ?? "");
  if (!DISBURSEMENT_METHODS.some((option) => option.value === methode)) {
    return { error: "Choisissez le mode de versement de l'avance", conflit: false };
  }

  const token = await requireSessionToken();
  try {
    await chooseFinancing(token, invoiceId, {
      financialPartnerId,
      disbursementMethod: methode as DisbursementMethod,
    });
  } catch (error) {
    if (error instanceof TrustApiError) {
      // 409 = la créance a déjà été cédée, ou la facture n'est plus finançable
      // (visa retiré, facture annulée entre-temps). Les deux disent la même
      // chose au commerçant : ce formulaire n'a plus d'objet, l'écran doit lui
      // montrer l'état réel plutôt que l'inviter à réessayer.
      return { error: error.message, conflit: error.status === 409 };
    }
    return { error: "Arbitrage temporairement indisponible", conflit: false };
  }

  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  revalidatePath("/dashboard/invoices");
  revalidatePath("/dashboard");

  return { ok: "Créance cédée. L'avance vous est versée par l'établissement financier." };
}

// ── Avoir rectificatif (C7, ADR-034/040) ────────────────────────────────────
//
// Le seul geste qui corrige une facture émise : elle est immuable, un avoir lui
// oppose un second document plutôt que de la réécrire. C'est ce que le bloc
// « Litige » de l'écran de détail ouvre.
//
// Le MONTANT n'est jamais envoyé : trust-api le calcule depuis
// quantityReturned × invoiceLine.unitPrice. Ce qui remonte d'ici, ce sont des
// QUANTITÉS et un motif — jamais une somme que le client aurait décidée.
export async function createCreditNoteAction(
  _prevState: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) {
    return { error: "Action impossible : identifiant de facture manquant" };
  }

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { error: "Le motif de l'avoir est obligatoire — il figure sur le document remis au client" };
  }

  let lines: { invoiceLineId: string; quantityReturned: number }[];
  try {
    lines = JSON.parse(String(formData.get("linesJson") ?? "[]"));
  } catch {
    return { error: "Lignes de l'avoir illisibles" };
  }
  // Le formulaire filtre déjà les quantités nulles ; ce test attrape le cas où
  // il n'en resterait AUCUNE — un avoir vide serait accepté par Zod comme un
  // tableau, puis refusé par `.min(1)` avec un message technique.
  if (!Array.isArray(lines) || lines.length === 0) {
    return { error: "Indiquez au moins une quantité à créditer" };
  }

  const token = await requireSessionToken();
  try {
    await createCreditNote(token, invoiceId, { reason, lines });
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Émission de l'avoir temporairement indisponible" };
  }

  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  revalidatePath("/dashboard/invoices");
  revalidatePath("/dashboard");

  return { ok: "Avoir rectificatif émis. Il figure au journal de la facture." };
}
