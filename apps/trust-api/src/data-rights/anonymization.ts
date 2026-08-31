// J2, ADR-116 — helpers purs de l'anonymisation d'un client.

/** `customer.name` est NOT NULL en base → jamais `null`, toujours ce tombstone. */
export const CUSTOMER_NAME_TOMBSTONE = "Client anonymisé";

/** Conservation comptable OHADA / fiscale : 10 ans. */
export const FISCAL_RETENTION_YEARS = 10;

const RETAINED_INVOICE_STATUSES = new Set(["issued", "partially_paid", "paid", "voided"]);

/**
 * Vrai si cette facture déclenche l'obligation de conservation légale (elle a
 * réellement été émise). Un brouillon, une proforma, un devis, une facture
 * expirée ou convertie n'imposent rien.
 */
export function isRetainedInvoice(invoice: { documentType: string; status: string }): boolean {
  return invoice.documentType === "invoice" && RETAINED_INVOICE_STATUSES.has(invoice.status);
}

/**
 * Échéance après laquelle `name` / `nif` d'un client anonymisé partiellement
 * pourront aussi être effacés : date de la facture conservée la plus récente
 * + 10 ans. `null` si aucune facture n'est sous conservation.
 */
export function retentionExpiryOf(
  invoices: { documentType: string; status: string; issuedAt: Date | null }[],
): Date | null {
  const retainedDates = invoices
    .filter(isRetainedInvoice)
    .map((i) => i.issuedAt)
    .filter((d): d is Date => d !== null);
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
