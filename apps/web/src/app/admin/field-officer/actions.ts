"use server";

import { requireSessionToken } from "@/lib/session";
import { createAssistedOrganization, TrustApiError } from "@/lib/trust-api";

export type FieldEnrolmentResult = { error: string } | { organizationId: string };

export async function enrolFieldMerchant(
  commerceName: string,
  merchantPhone: string,
): Promise<FieldEnrolmentResult> {
  const name = commerceName.trim();
  const msisdn = merchantPhone.trim();
  if (!name || !/^\d{9}$/.test(msisdn)) {
    return { error: "Saisissez un nom de commerce et un numéro guinéen à 9 chiffres." };
  }

  try {
    const token = await requireSessionToken();
    const organization = await createAssistedOrganization(token, {
      organizationName: name,
      regimeFiscal: "tpu",
      legalForm: "commercial",
      merchantName: name,
      msisdn,
      consentRecorded: true,
    });
    return { organizationId: organization.id };
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Création du compte temporairement indisponible. Réessayez." };
  }
}