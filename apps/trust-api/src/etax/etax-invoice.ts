import type { RegimeFiscal } from "@facture-gn/db";
// Le taux vient de tax-regime.ts (C4, ADR-033 : jamais un taux TVA plat),
// jamais d'une constante recopiée ici.
import { resolveTaxRateBps } from "../invoices/tax-regime";
import { resolveTaxCode } from "./etax-declaration";

// Transmission UNITAIRE d'une facture au guichet e-TVA (LFI 2025). Fonctions
// pures, hors Nest et hors BullMQ — même découpe que etax-declaration.ts.
//
// CE N'EST PAS LA MÊME OBLIGATION QUE LA DÉCLARATION PÉRIODIQUE, et les deux
// coexistent : la déclaration annuelle consolide un exercice à sa clôture, la
// transmission unitaire signale chaque facture à son émission. Transmettre l'une
// ne dispense pas de l'autre.

/** Ce que la DGI reçoit quand un particulier achète : il n'a pas de NIF, et en
 *  inventer un serait une fausse déclaration. Le guichet attend cette valeur
 *  convenue plutôt qu'un champ vide. */
export const ACQUEREUR_PARTICULIER = "PARTICULIER";

// Mêmes règles de sérialisation que EtaxDeclarationPayload : BullMQ écrit `data`
// en JSON dans Redis et `JSON.stringify(1n)` LÈVE. Les montants sont donc des
// chaînes, et le type le dit.
export interface EtaxInvoicePayload {
  invoiceId: string;
  organizationId: string;
  /** Numéro eTax de l'ÉMETTEUR — l'identité fiscale sous laquelle on déclare. */
  etaxNumberEmetteur: string;
  /** NIF de l'acquéreur, ou ACQUEREUR_PARTICULIER. */
  nifAcquereur: string;
  /** FG-YYYY-NNNNNN, le numéro légal séquentiel (Article 23 OHADA). */
  numero: string;
  /** GN-{NIF8}-{YYYY}-{HASH6} — l'identifiant de vérification publique. */
  certificationId: string;
  /** Montants en francs guinéens entiers, sérialisés en chaîne. */
  totalHt: string;
  totalTva: string;
  totalTtc: string;
  taxRateBps: number;
  taxCode: string;
  issuedAt: string;
  /** Hash de certification Ed25519 de la facture. Sert de CLÉ D'IDEMPOTENCE
   *  auprès du guichet, exactement comme sealHash pour la déclaration
   *  périodique : il est déterministe, déjà calculé, et deux transmissions de la
   *  même facture le portent forcément à l'identique. */
  hash: string;
}

export interface InvoiceForEtax {
  id: string;
  organizationId: string;
  number: string | null;
  certificationId: string | null;
  hash: string | null;
  totalHt: bigint;
  totalTva: bigint;
  totalTtc: bigint;
  issuedAt: Date | null;
}

/** Assemble le payload d'une facture émise.
 *
 *  LÈVE plutôt que de transmettre un payload incomplet. Une transmission ne se
 *  retire pas : mieux vaut un échec net ici — visible, compté, rattrapable — que
 *  la DGI enregistrant une facture sans numéro ni sceau, qu'aucune vérification
 *  publique ne pourra plus rapprocher. */
export function buildEtaxInvoice(
  invoice: InvoiceForEtax,
  organization: { etaxNumber: string | null; regimeFiscal: RegimeFiscal },
  customer: { nif: string | null } | null,
): EtaxInvoicePayload {
  if (!organization.etaxNumber) {
    throw new Error(
      `Organisation ${invoice.organizationId} sans numéro eTax — la facture ${invoice.id} n'a aucun destinataire chez la DGI`,
    );
  }
  // Les trois marques de la certification. Leur absence signifie que la facture
  // n'a pas été émise : rien à transmettre, et le dire clairement.
  if (!invoice.number || !invoice.certificationId || !invoice.hash || !invoice.issuedAt) {
    throw new Error(
      `Facture ${invoice.id} non certifiée (numéro, identifiant de certification, hash ou date d'émission manquant) — transmission impossible`,
    );
  }

  return {
    invoiceId: invoice.id,
    organizationId: invoice.organizationId,
    etaxNumberEmetteur: organization.etaxNumber,
    // Un client sans NIF n'est pas une anomalie : c'est le cas normal du
    // commerce de détail. On le déclare comme tel.
    nifAcquereur: customer?.nif ?? ACQUEREUR_PARTICULIER,
    numero: invoice.number,
    certificationId: invoice.certificationId,
    totalHt: invoice.totalHt.toString(),
    totalTva: invoice.totalTva.toString(),
    totalTtc: invoice.totalTtc.toString(),
    taxRateBps: resolveTaxRateBps(organization.regimeFiscal),
    taxCode: resolveTaxCode(organization.regimeFiscal),
    issuedAt: invoice.issuedAt.toISOString(),
    hash: invoice.hash,
  };
}
