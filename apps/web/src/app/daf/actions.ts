"use server";

import { revalidatePath } from "next/cache";
import { requireSessionToken } from "@/lib/session";
import { confirmCustomerLink, TrustApiError, validateLiquidation } from "@/lib/trust-api";

export type LiquidationActionState = { error: string } | { ok: string } | null;

// J1 — VISER LE SERVICE FAIT.
//
// L'identifiant de facture vient du formulaire, et c'est sans danger : la route
// n'a aucun @Roles()/@OrganizationIdSource, toute son autorisation est inline
// dans PublicBuyerPortalService (appartenance au compte acheteur public du
// client, compte « verified », rattachement confirmé). Un identifiant forgé se
// heurte donc à la même chaîne qu'un identifiant légitime — et le service rend
// volontairement le MÊME message pour « facture inconnue » et « pas une facture
// B2G », pour ne pas devenir un oracle d'énumération. Ne jamais « améliorer »
// ces messages ici : ce serait rouvrir l'oracle côté web.
export async function validateLiquidationAction(
  _prev: LiquidationActionState,
  formData: FormData,
): Promise<LiquidationActionState> {
  const token = await requireSessionToken();

  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  if (!invoiceId) {
    return { error: "Facture introuvable" };
  }

  try {
    await validateLiquidation(token, invoiceId);
  } catch (error) {
    if (error instanceof TrustApiError) {
      // 409 = draft ou voided (aucune créance à liquider). Un double clic, lui,
      // ne produit JAMAIS de 409 : le service est idempotent sur une facture
      // déjà visée et renvoie 200 sans créer un second InvoiceEvent. Les deux
      // cas restent distingués parce qu'ils veulent dire des choses opposées —
      // « rien à viser » n'est pas « déjà visé ».
      return { error: error.message };
    }
    return { error: "Visa temporairement indisponible" };
  }

  revalidatePath("/daf");
  return { ok: "Service fait visé. La créance est reconnue et devient finançable." };
}

// Security Audit 2026-08-23, finding #13 — CONFIRMER LE RATTACHEMENT.
//
// Une PME peut désigner unilatéralement n'importe quel compte acheteur public
// comme étant celui de son client (flagPublicEntity() n'en vérifie que
// l'existence, jamais le consentement). Tant que le compte CIBLÉ n'a pas
// confirmé, la facture reste invisible dans listReceivedInvoices() — d'où la
// présence de ce geste dans la console : sans lui, un DAF verrait une liste
// vide sans jamais comprendre pourquoi.
export async function confirmCustomerLinkAction(
  _prev: LiquidationActionState,
  formData: FormData,
): Promise<LiquidationActionState> {
  const token = await requireSessionToken();

  const customerId = String(formData.get("customerId") ?? "").trim();
  if (!customerId) {
    return { error: "Client introuvable" };
  }

  try {
    await confirmCustomerLink(token, customerId);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Confirmation temporairement indisponible" };
  }

  revalidatePath("/daf");
  return { ok: "Rattachement confirmé. Les factures de ce fournisseur apparaissent désormais ici." };
}
