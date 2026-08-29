import type { InvoiceDocumentType } from "@facture-gn/db";

// UNTDID 1001 — EN 16931 BT-3 (Invoice type code). Alignement Lot C / ADR-109,
// préparation de l'export UBL 2.1 (ADR-053). Le devis (offre commerciale) n'a
// pas de code UNTDID 1001 dédié : null plutôt qu'un code approché.
export function untdidTypeCode(documentType: InvoiceDocumentType): "380" | "325" | null {
  switch (documentType) {
    case "invoice":
      return "380"; // Commercial invoice
    case "proforma":
      return "325"; // Proforma invoice
    case "quote":
      return null;
  }
}
