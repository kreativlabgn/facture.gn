"use server";

import { revalidatePath } from "next/cache";
import { requireSessionToken } from "@/lib/session";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { normaliserMsisdnGn } from "@/lib/phone-gn";
import { createInvoice, issueInvoice, resolveCustomerByPhone, TrustApiError } from "@/lib/trust-api";

/** `"payment_link"` engage la vente au comptoir sur un règlement à distance
 *  (ADR-106 étendu) — n'existe dans AUCUN contrat trust-api : c'est un choix
 *  purement côté web, qui ne fait que (a) rendre le téléphone obligatoire et
 *  (b) informer l'écran de confirmation. trust-api décide seul, par
 *  organisation (`paymentLinkAutoSend`), d'envoyer ou non un lien — un
 *  marchand qui choisit "cash" avec un numéro renseigné peut donc très bien
 *  recevoir quand même un `paymentLinkUrl` non nul en retour : l'écran de
 *  confirmation se fie à `paymentLinkUrl`, jamais à `settlementMode` seul,
 *  pour décider d'afficher le bloc lien. */
export type SettlementMode = "cash" | "payment_link";

export type CreateInvoiceSuccess = {
  invoiceId: string;
  /** `null` uniquement pour un statut qui n'existe pas ici : issueInvoice()
   *  vient de faire passer la facture par le cycle d'émission, qui attribue
   *  toujours un numéro de séquence légal. Type nullable quand même — c'est
   *  la même colonne que InvoiceDetail.number, jamais réécrite en local. */
  number: string | null;
  totalTtc: string;
  paymentLinkUrl: string | null;
  paymentLinkExpiresAt: string | null;
  settlementMode: SettlementMode;
  /** Numéro canonique résolu depuis le champ téléphone de CE formulaire —
   *  jamais déduit d'une fiche client déjà existante (hors périmètre de ce
   *  formulaire, qui n'a pas de sélecteur de client). `null` si la facture
   *  reste anonyme : l'écran ne doit alors jamais affirmer un envoi SMS qui
   *  n'a pas eu lieu. */
  customerPhone: string | null;
};

// ADR-064 — un devis créé depuis cet écran n'est JAMAIS émis (voir la
// bifurcation plus bas) : son état de succès ne porte donc que `quoteId`,
// jamais `invoiceId`. C'est ce qui garantit que le narrowing `"invoiceId" in
// state` de VenteComptoirForm.tsx (fichier gelé, jamais `documentType=quote`
// dans son formulaire) ne matche jamais cette branche par erreur.
export type CreateQuoteDraftSuccess = {
  documentType: "quote";
  quoteId: string;
};

export type CreateInvoiceActionState = { error: string } | CreateInvoiceSuccess | CreateQuoteDraftSuccess | null;

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

  const settlementModeRaw = formData.get("settlementMode");
  const settlementMode: SettlementMode = settlementModeRaw === "payment_link" ? "payment_link" : "cash";

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

  // Un lien de paiement n'a nulle part où aller sans numéro : refusé AVANT
  // tout appel réseau, comme le refus de format ci-dessous — même discipline.
  // Le mode espèces (par défaut) ne change rien : le téléphone y reste
  // facultatif, exactement comme avant ce choix.
  if (settlementMode === "payment_link" && telephoneSaisi === "") {
    return { error: "Un numéro est nécessaire pour envoyer un lien de paiement" };
  }

  let customerPhone: string | null = null;
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
      customerPhone = msisdn;
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

  // F, ADR-064 — même discipline que referenceMarche : champ déclaratif,
  // jamais vérifié ici, transmis tel quel (format "YYYY-MM-DD" rendu par un
  // <input type="date">). N'est lu par le formulaire que pour un devis, mais
  // rien n'empêche de le lire ici pour tous les documentType — seule la
  // branche devis ci-dessous le transmet réellement à createInvoice().
  const quoteValidUntilRaw = formData.get("quoteValidUntil");
  const quoteValidUntil =
    quoteValidUntilRaw && String(quoteValidUntilRaw).trim() !== "" ? String(quoteValidUntilRaw).trim() : undefined;

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

  // ADR-064 — un devis est un document préliminaire NON engageant : il ne
  // doit jamais être émis (issueInvoice() rejette tout documentType ≠
  // "invoice" en 409, voir invoices.service.ts) ni consommer de numéro de
  // séquence légal. Seule la conversion explicite depuis l'écran de détail
  // (convertToInvoiceAction) produit ensuite une vraie facture brouillon.
  // Bifurcation placée juste avant l'appel réseau qui émettrait.
  if (documentType === "quote") {
    let draft;
    try {
      draft = await createInvoice(token, {
        organizationId: organization.id,
        documentType,
        customerId,
        lines,
        referenceMarche,
        quoteValidUntil,
      });
    } catch (error) {
      if (error instanceof TrustApiError) {
        return { error: error.message };
      }
      return { error: "Création du devis temporairement indisponible" };
    }

    // Seule la liste change ici — contrairement à la branche facture, aucun
    // montant encaissé ni statut de règlement n'a bougé sur /dashboard.
    revalidatePath("/dashboard/invoices");

    return { documentType: "quote", quoteId: draft.id };
  }

  let issued;
  try {
    const invoice = await createInvoice(token, {
      organizationId: organization.id,
      documentType,
      customerId,
      lines,
      referenceMarche,
    });
    issued = await issueInvoice(token, invoice.id);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Émission temporairement indisponible" };
  }

  // La liste affiche le statut et le montant : les deux peuvent changer ici
  // — même paire que invoices/[id]/actions.ts.
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/invoices");

  // Jamais de redirect() ici : deux appelants partagent cette action
  // (InvoiceForm, VenteComptoirForm) et n'en font pas la même chose du
  // succès — l'un redirige côté client, l'autre affiche une confirmation
  // inline. Le choix leur appartient, pas à l'action.
  return {
    invoiceId: issued.id,
    number: issued.number,
    totalTtc: issued.totalTtc,
    paymentLinkUrl: issued.paymentLinkUrl,
    paymentLinkExpiresAt: issued.paymentLinkExpiresAt,
    settlementMode,
    customerPhone,
  };
}
