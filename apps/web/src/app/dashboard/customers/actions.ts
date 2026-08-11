"use server";

import { revalidatePath } from "next/cache";
import { requireSessionToken } from "@/lib/session";
import { createCustomer, listMyOrganizations, TrustApiError } from "@/lib/trust-api";

export type CreateCustomerActionState = { error: string } | null;

export async function createCustomerAction(
  _prevState: CreateCustomerActionState,
  formData: FormData,
): Promise<CreateCustomerActionState> {
  const token = await requireSessionToken();
  const organizations = await listMyOrganizations(token);
  const organization = organizations[0];
  if (!organization) {
    return { error: "Aucune organisation associée à ce compte" };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Le nom du client est requis" };
  }
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const nifRaw = String(formData.get("nif") ?? "").trim();

  try {
    await createCustomer(token, {
      organizationId: organization.id,
      name,
      phone: phoneRaw || undefined,
      nif: nifRaw || undefined,
    });
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Création temporairement indisponible" };
  }

  revalidatePath("/dashboard/customers");
  return null;
}
