"use server";

import { redirect } from "next/navigation";
import { requireSessionToken } from "@/lib/session";
import { validateFiscalIdentity, type FiscalField } from "@/lib/fiscal";
import { TrustApiError, createOrganization } from "@/lib/trust-api";

export type OnboardingActionState = {
  error: string;
  fieldErrors?: Partial<Record<FiscalField, string>>;
  values?: { name: string; legalForm: string; regimeFiscal: string; nif: string; etaxNumber: string };
} | null;

export async function createOrganizationAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const token = await requireSessionToken();

  const name = String(formData.get("name") ?? "").trim();
  const legalForm = String(formData.get("legalForm") ?? "");
  const regimeFiscal = String(formData.get("regimeFiscal") ?? "");
  const nif = String(formData.get("nif") ?? "").trim();
  const etaxNumber = String(formData.get("etaxNumber") ?? "").trim();
  const values = { name, legalForm, regimeFiscal, nif, etaxNumber };

  const violations = validateFiscalIdentity({ name, legalForm, regimeFiscal, nif, etaxNumber });
  if (violations.length > 0) {
    const fieldErrors: Partial<Record<FiscalField, string>> = {};
    for (const violation of violations) {
      fieldErrors[violation.field] ??= violation.message;
    }
    return { error: "Vérifiez les champs signalés.", fieldErrors, values };
  }

  try {
    await createOrganization(token, {
      name,
      legalForm,
      regimeFiscal,
      // Omis plutôt qu'envoyés vides : le DTO impose .min(1) sur chacun, une
      // chaîne vide serait rejetée là où l'absence est parfaitement valide.
      nif: nif || undefined,
      etaxNumber: etaxNumber || undefined,
    });
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message, values };
    }
    return { error: "Création de l'organisation temporairement indisponible", values };
  }

  // Aucun cookie fg_active_org à poser : cet écran n'est atteignable qu'avec
  // zéro organisation (voir page.tsx), donc celle qu'on vient de créer est la
  // seule, et pickActiveOrganization retombe déjà dessus. Poser le cookie
  // n'ajouterait aucun comportement — seulement un chemin de plus à maintenir.
  redirect("/dashboard");
}
