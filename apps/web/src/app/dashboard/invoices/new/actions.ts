"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSessionToken } from "@/lib/session";
import { createInvoice, issueInvoice, listMyOrganizations, TrustApiError } from "@/lib/trust-api";

export type CreateInvoiceActionState = { error: string } | null;

interface RawLine {
  description: string;
  quantity: number;
  unitPriceGnf: number;
}

// organizationId n'est JAMAIS lu depuis le formulaire — résolu ici depuis la
// session, même discipline que dashboard/layout.tsx : ne jamais faire
// confiance à un champ client pour une valeur qui détermine l'autorisation.
export async function createAndIssueInvoiceAction(
  _prevState: CreateInvoiceActionState,
  formData: FormData,
): Promise<CreateInvoiceActionState> {
  const token = await requireSessionToken();
  const organizations = await listMyOrganizations(token);
  const organization = organizations[0];
  if (!organization) {
    return { error: "Aucune organisation associée à ce compte" };
  }

  const documentType = String(formData.get("documentType") ?? "invoice") as "invoice" | "proforma" | "quote";
  const customerIdRaw = formData.get("customerId");
  const customerId = customerIdRaw && customerIdRaw !== "" ? String(customerIdRaw) : undefined;

  let rawLines: RawLine[];
  try {
    rawLines = JSON.parse(String(formData.get("linesJson") ?? "[]"));
  } catch {
    return { error: "Lignes de facture invalides" };
  }
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return { error: "Au moins une ligne est requise" };
  }

  // Saisie en GNF (naturel pour le staff, voir mockup) → centimes GNF pour
  // l'API (convention repo, voir schema.prisma) — jamais l'inverse, jamais
  // laissé au client de faire cette conversion.
  const lines = rawLines.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unitPrice: String(Math.round(line.unitPriceGnf * 100)),
  }));

  try {
    const invoice = await createInvoice(token, {
      organizationId: organization.id,
      documentType,
      customerId,
      lines,
    });
    await issueInvoice(token, invoice.id);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Émission temporairement indisponible" };
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
