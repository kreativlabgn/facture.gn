import type { PublicInvoiceVerification } from "@/lib/trust-api";
import { formatDate, formatGnf } from "@/lib/format";
import { DisputeStatusPill, StatusPill } from "./StatusPill";

export function InvoiceSummary({ invoice }: { invoice: PublicInvoiceVerification }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">Facture</p>
          <p className="text-xl font-semibold text-ink-950">{invoice.number}</p>
        </div>
        <div className="flex gap-2">
          <StatusPill status={invoice.status} />
          <DisputeStatusPill disputeStatus={invoice.disputeStatus} />
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Émise par">
          {invoice.organizationName}
          {invoice.organizationNif ? (
            <span className="block text-sm text-ink-500">NIF {invoice.organizationNif}</span>
          ) : null}
        </Field>
        <Field label="Montant certifié">
          <span className="text-lg font-semibold text-ink-950">{formatGnf(invoice.totalTtc)}</span>
        </Field>
        <Field label="Date d'émission">{formatDate(invoice.issuedAt)}</Field>
        <Field label="Validée par l'administration">{invoice.validatedByAdministration ? "Oui" : "Non"}</Field>
      </dl>

      <div className="mt-6 border-t border-ink-100 pt-4">
        <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">Identifiant de vérification</p>
        <p className="mt-1 font-mono text-sm text-ink-700 break-all">{invoice.certificationId}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className="mt-1 text-ink-950">{children}</dd>
    </div>
  );
}
