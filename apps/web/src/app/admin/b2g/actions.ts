"use server";

import { revalidatePath } from "next/cache";
import { requireSessionToken } from "@/lib/session";
import { registerObjection, TrustApiError, validateLiquidation } from "@/lib/trust-api";

export interface LiquidationPayload {
  invoiceId: string;
}

export type LiquidationActionResult =
  | { success: true; message: string }
  | { success: false; error: string };

export interface ObjectionPayload {
  invoiceId: string;
  reason: string;
}

/**
 * Adapts the infrastructure console to the existing DAF liquidation contract.
 * Authorization remains entirely in trust-api's public-buyer service.
 */
export async function validerLiquidationAction(
  payload: LiquidationPayload,
): Promise<LiquidationActionResult> {
  const invoiceId = payload.invoiceId.trim();
  if (!invoiceId) {
    return { success: false, error: "Facture introuvable" };
  }

  try {
    const sessionToken = await requireSessionToken();
    await validateLiquidation(sessionToken, invoiceId);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "Visa temporairement indisponible" };
  }

  revalidatePath("/admin/b2g");
  revalidatePath("/daf");
  return { success: true, message: "Service fait visé. La créance est reconnue et devient finançable." };
}

export async function leverObjectionAction(
  payload: ObjectionPayload,
): Promise<LiquidationActionResult> {
  const invoiceId = payload.invoiceId.trim();
  const reason = payload.reason.trim();
  if (!invoiceId) {
    return { success: false, error: "Facture introuvable" };
  }
  if (!reason || reason.length > 1000) {
    return { success: false, error: "Le motif de l'objection est requis (1 000 caractères maximum)." };
  }

  try {
    const sessionToken = await requireSessionToken();
    const result = await registerObjection(sessionToken, invoiceId, reason);
    revalidatePath("/admin/b2g");
    revalidatePath("/daf");
    return { success: true, message: result.message };
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "Objection temporairement indisponible" };
  }
}
