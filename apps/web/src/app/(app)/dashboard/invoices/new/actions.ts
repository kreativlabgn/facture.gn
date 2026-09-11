"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSessionToken } from "@/lib/session";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { normaliserMsisdnGn } from "@/lib/phone-gn";
import { createInvoice, issueInvoice, resolveCustomerByPhone, TrustApiError } from "@/lib/trust-api";

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
  const { active: organization } = await resolveActiveOrganization(token);
  if (!organization) {
    return { error: "Aucune organisation associée à ce compte" };
  }

  const documentType = String(formData.get("documentType") ?? "invoice") as "invoice" | "proforma" | "quote";
  const customerIdRaw = formData.get("customerId");
  let customerId = customerIdRaw && customerIdRaw !== "" ? String(customerIdRaw) : undefined;

  // ── Vente au comptoir sur un simple numéro (ADR-106) ──────────────────────
  //
  // Le commerçant n'a souvent que le numéro de son client, et la file d'une
  // boutique n'est pas le moment de saisir une fiche complète. Le numéro suffit
  // désormais : trust-api renvoie le client de ce numéro, ou en crée un
  // (« Client +224XXXXXXXXX ») sous verrou consultatif — deux caisses qui
  // encaissent le même numéro à la même seconde obtiennent la MÊME fiche.
  //
  // Une fiche CHOISIE dans la liste l'emporte toujours : c'est un choix
  // explicite du commerçant, et un numéro resté dans le champ ne doit pas le
  // remplacer en silence.
  const telephoneRaw = formData.get("customerPhone");
  const telephoneSaisi = telephoneRaw ? String(telephoneRaw).trim() : "";
  if (!customerId && telephoneSaisi !== "") {
    // La normalisation est faite ICI et nulle part ailleurs (voir phone-gn.ts).
    // Le refus est prononcé AVANT tout appel réseau : un numéro qui ne peut pas
    // être guinéen n'a aucune raison de coûter un aller-retour, et le message
    // dit quoi corriger — là où un 400 traduit d'un message de schéma ne le
    // dirait pas.
    const msisdn = normaliserMsisdnGn(telephoneSaisi);
    if (!msisdn) {
      return { error: "Numéro de téléphone invalide — 9 chiffres attendus (ex. 622 00 00 00)" };
    }
    try {
      const client = await resolveCustomerByPhone(token, organization.id, msisdn);
      customerId = client.id;
    } catch (error) {
      if (error instanceof TrustApiError) {
        return { error: error.message };
      }
      return { error: "Rattachement du numéro temporairement indisponible" };
    }
  }

  // K3, ADR-090 — champ libre optionnel, jamais vérifié ici ni côté serveur.
  const referenceMarcheRaw = formData.get("referenceMarche");
  const referenceMarche =
    referenceMarcheRaw && String(referenceMarcheRaw).trim() !== "" ? String(referenceMarcheRaw).trim() : undefined;

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
      referenceMarche,
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
