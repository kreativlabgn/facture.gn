"use server";

import { redirect } from "next/navigation";
import { validatePractice, type PracticeField } from "@/lib/practice";
import { requireSessionToken } from "@/lib/session";
import { createPractice, TrustApiError } from "@/lib/trust-api";

export type NouveauCabinetState = {
  error: string;
  fieldErrors?: Partial<Record<PracticeField, string>>;
  values?: { name: string; type: string; registrationNumber: string; phone: string; email: string };
} | null;

export async function createPracticeAction(
  _prevState: NouveauCabinetState,
  formData: FormData,
): Promise<NouveauCabinetState> {
  const token = await requireSessionToken();

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const registrationNumber = String(formData.get("registrationNumber") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const values = { name, type, registrationNumber, phone, email };

  // Validation locale d'abord, pour rendre un message PAR CHAMP plutôt qu'une
  // erreur globale. trust-api reste seul juge : ce contrôle ne fait qu'éviter
  // un aller-retour réseau sur des fautes évidentes.
  const violations = validatePractice({ name, type, phone, email });
  if (violations.length > 0) {
    const fieldErrors: Partial<Record<PracticeField, string>> = {};
    for (const violation of violations) {
      fieldErrors[violation.field] ??= violation.message;
    }
    return { error: "Vérifiez les champs signalés.", fieldErrors, values };
  }

  try {
    await createPractice(token, {
      name,
      type,
      // Omis plutôt qu'envoyés vides : le DTO impose `.min(1)` sur ces deux
      // champs facultatifs, une chaîne vide serait donc rejetée là où
      // l'absence est parfaitement valide.
      registrationNumber: registrationNumber || undefined,
      phone,
      email: email || undefined,
    });
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message, values };
    }
    return { error: "Création du cabinet temporairement indisponible.", values };
  }

  // Hors du try/catch : redirect() lève une erreur interne à Next, que le catch
  // ci-dessus prendrait pour un échec de création.
  redirect("/cabinet");
}
