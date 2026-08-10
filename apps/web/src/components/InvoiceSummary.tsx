import type { PublicInvoiceVerification } from "@/lib/trust-api";
import { formatDate, formatGnf } from "@/lib/format";
import { DisputeStatusPill, StatusPill } from "./StatusPill";

// Reproduit ".verify-detail"/".verify-row" de la maquette de référence
// (Écran 04) : lignes label (navy-600) / valeur, séparateur navy-50. Champs
// de la maquette (Émise par, Montant certifié, Statut, Contestation,
// Signature) + numéro/date/NIF déjà exposés par l'API mais absents de la
// maquette illustrative — ajoutés dans le même langage visuel plutôt
// qu'omis, la maquette n'étant pas exhaustive sur les champs réels.
export function InvoiceSummary({ invoice }: { invoice: PublicInvoiceVerification }) {
  return (
    <div className="mt-5 rounded-2xl border border-navy-100 bg-white p-5 text-left">
      <Row label="Facture">
        <span className="font-mono text-sm font-bold text-navy-950">{invoice.number}</span>
      </Row>
      <Row label="Émise par">
        <span className="font-semibold text-navy-950">
          {invoice.organizationName}
          {invoice.organizationNif ? <span className="ml-1 font-normal text-navy-600">· NIF {invoice.organizationNif}</span> : null}
        </span>
      </Row>
      <Row label="Montant certifié">
        <span className="font-mono text-sm font-bold text-navy-950">{formatGnf(invoice.totalTtc)}</span>
      </Row>
      <Row label="Date d'émission">
        <span className="text-navy-950">{formatDate(invoice.issuedAt)}</span>
      </Row>
      <Row label="Statut de paiement">
        <StatusPill status={invoice.status} />
      </Row>
      <Row label="Contestation">
        <span className="text-navy-950">{invoice.disputeStatus === "none" ? "Aucune" : <DisputeStatusPill disputeStatus={invoice.disputeStatus} />}</span>
      </Row>
      <Row label="Validée par l'administration">
        <span className="text-navy-950">{invoice.validatedByAdministration ? "Oui" : "Non"}</span>
      </Row>
      <Row label="Signature" last>
        <span className="font-mono text-xs font-bold text-navy-950">
          {invoice.integrityValid ? "Ed25519 ✓ · SHA-256 ✓" : "Ed25519 ✗ · SHA-256 ✗"}
        </span>
      </Row>
      <div className="mt-3 border-t border-navy-50 pt-3">
        {/* "caption" de la charte : Inter Regular — pas Poppins/gras, ce n'est
            pas un label de formulaire (réservé à la charte pour Poppins SemiBold). */}
        <p className="text-[10px] font-normal tracking-wide text-navy-600 uppercase">Identifiant de vérification</p>
        <p className="mt-1 font-mono text-xs font-bold break-all text-navy-600">{invoice.certificationId}</p>
      </div>
    </div>
  );
}

function Row({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-2.5 text-sm ${last ? "" : "border-b border-navy-50"}`}>
      <span className="text-navy-600">{label}</span>
      {children}
    </div>
  );
}
