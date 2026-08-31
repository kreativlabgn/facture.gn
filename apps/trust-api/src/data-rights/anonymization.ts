import type { $Enums } from "@facture-gn/db";

// J2, ADR-116 — helpers purs de l'anonymisation d'un client.

/** `customer.name` est NOT NULL en base → jamais `null`, toujours ce tombstone. */
export const CUSTOMER_NAME_TOMBSTONE = "Client anonymisé";

/** Conservation comptable OHADA / fiscale : 10 ans. */
export const FISCAL_RETENTION_YEARS = 10;

// Typé contre l'enum Prisma : un renommage de statut dans schema.prisma casse
// désormais la compilation ici (au lieu d'un `false` silencieux qui
// anonymiserait complètement un client dont le nom est légalement obligatoire
// sur une facture OHADA).
const RETAINED_INVOICE_STATUSES = [
  "issued",
  "partially_paid",
  "paid",
  "voided",
] as const satisfies readonly $Enums.InvoiceStatus[];

const RETAINED_INVOICE_STATUS_SET: ReadonlySet<string> = new Set(RETAINED_INVOICE_STATUSES);

type RetentionInvoice = {
  documentType: $Enums.InvoiceDocumentType;
  status: $Enums.InvoiceStatus;
  issuedAt?: Date | null;
};

/**
 * Vrai si cette facture déclenche l'obligation de conservation légale (elle a
 * réellement été émise). Un brouillon, une proforma, un devis, une facture
 * expirée ou convertie n'imposent rien.
 */
export function isRetainedInvoice(invoice: Pick<RetentionInvoice, "documentType" | "status">): boolean {
  return invoice.documentType === "invoice" && RETAINED_INVOICE_STATUS_SET.has(invoice.status);
}

/**
 * Échéance après laquelle `name` / `nif` d'un client anonymisé partiellement
 * pourront aussi être effacés : date de la facture conservée la plus récente
 * + 10 ans. `null` si aucune facture n'est sous conservation.
 */
export function retentionExpiryOf(invoices: RetentionInvoice[]): Date | null {
  const retainedDates = invoices
    .filter(isRetainedInvoice)
    .map((i) => i.issuedAt)
    .filter((d): d is Date => d != null);
  if (retainedDates.length === 0) {
    return null;
  }
  const latest = new Date(Math.max(...retainedDates.map((d) => d.getTime())));
  return new Date(
    Date.UTC(
      latest.getUTCFullYear() + FISCAL_RETENTION_YEARS,
      latest.getUTCMonth(),
      latest.getUTCDate(),
      latest.getUTCHours(),
      latest.getUTCMinutes(),
      latest.getUTCSeconds(),
      latest.getUTCMilliseconds(),
    ),
  );
}
