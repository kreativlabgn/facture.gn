import { formatFecLine } from "./fec-formatting";

export interface FecPaymentInput {
  amount: bigint;
  method: "cash" | "payment_link" | "bank_transfer";
  status: string;
  depositType: string | null;
  collectedAt: Date;
}

export interface FecInvoiceInput {
  number: string;
  issuedAt: Date;
  totalHt: bigint;
  totalTva: bigint;
  totalTtc: bigint;
  payments: FecPaymentInput[];
}

// HYPOTHÈSE COMPTABLE OHADA/SYSCOHADA — à faire valider par un comptable avant
// toute mise en production réelle (aucune spec FEC/plan comptable propre au
// projet, décision actée avec l'utilisateur, voir docs/plans/2026-08-09-fec-export.md).
const ACCOUNT_CLIENT = { num: "411", lib: "Clients" };
const ACCOUNT_SALES = { num: "707", lib: "Ventes de marchandises" };
const ACCOUNT_VAT = { num: "443", lib: "État, TVA facturée" };
const ACCOUNT_CASH = { num: "571", lib: "Caisse" };
const ACCOUNT_BANK = { num: "521", lib: "Banques locales" };

// Arrhes (depositType: "arrhes") jamais incluses — bucket financier séparé,
// même précédent que C5/C7/C13, aucun impact sur le solde de la facture donc
// aucune écriture de règlement légitime à en tirer ici.
function isSettledPayment(payment: FecPaymentInput): boolean {
  return payment.status === "completed" && payment.depositType === null;
}

// ADR-062 — "Export FEC = N écritures par facture" : chaque paiement produit sa
// propre écriture de règlement, jamais une seule ligne agrégée par facture.
export function generateFecEntries(invoices: FecInvoiceInput[]): string[] {
  let ecritureNum = 0;
  const lines: string[] = [];
  const nextNum = () => ++ecritureNum;

  for (const invoice of invoices) {
    lines.push(
      formatFecLine({
        journalCode: "VE",
        journalLib: "Journal des ventes",
        ecritureNum: nextNum(),
        ecritureDate: invoice.issuedAt,
        compteNum: ACCOUNT_CLIENT.num,
        compteLib: ACCOUNT_CLIENT.lib,
        pieceRef: invoice.number,
        pieceDate: invoice.issuedAt,
        ecritureLib: `Facture ${invoice.number}`,
        debit: invoice.totalTtc,
        credit: null,
        validDate: invoice.issuedAt,
      }),
    );
    lines.push(
      formatFecLine({
        journalCode: "VE",
        journalLib: "Journal des ventes",
        ecritureNum: nextNum(),
        ecritureDate: invoice.issuedAt,
        compteNum: ACCOUNT_SALES.num,
        compteLib: ACCOUNT_SALES.lib,
        pieceRef: invoice.number,
        pieceDate: invoice.issuedAt,
        ecritureLib: `Facture ${invoice.number}`,
        debit: null,
        credit: invoice.totalHt,
        validDate: invoice.issuedAt,
      }),
    );
    if (invoice.totalTva > 0n) {
      lines.push(
        formatFecLine({
          journalCode: "VE",
          journalLib: "Journal des ventes",
          ecritureNum: nextNum(),
          ecritureDate: invoice.issuedAt,
          compteNum: ACCOUNT_VAT.num,
          compteLib: ACCOUNT_VAT.lib,
          pieceRef: invoice.number,
          pieceDate: invoice.issuedAt,
          ecritureLib: `Facture ${invoice.number}`,
          debit: null,
          credit: invoice.totalTva,
          validDate: invoice.issuedAt,
        }),
      );
    }

    for (const payment of invoice.payments) {
      if (!isSettledPayment(payment)) {
        continue;
      }
      const cashAccount = payment.method === "cash" ? ACCOUNT_CASH : ACCOUNT_BANK;
      const journalCode = payment.method === "cash" ? "CA" : "BQ";
      const journalLib = payment.method === "cash" ? "Journal de caisse" : "Journal de banque";

      lines.push(
        formatFecLine({
          journalCode,
          journalLib,
          ecritureNum: nextNum(),
          ecritureDate: payment.collectedAt,
          compteNum: cashAccount.num,
          compteLib: cashAccount.lib,
          pieceRef: invoice.number,
          pieceDate: payment.collectedAt,
          ecritureLib: `Règlement facture ${invoice.number}`,
          debit: payment.amount,
          credit: null,
          validDate: payment.collectedAt,
        }),
      );
      lines.push(
        formatFecLine({
          journalCode,
          journalLib,
          ecritureNum: nextNum(),
          ecritureDate: payment.collectedAt,
          compteNum: ACCOUNT_CLIENT.num,
          compteLib: ACCOUNT_CLIENT.lib,
          pieceRef: invoice.number,
          pieceDate: payment.collectedAt,
          ecritureLib: `Règlement facture ${invoice.number}`,
          debit: null,
          credit: payment.amount,
          validDate: payment.collectedAt,
        }),
      );
    }
  }

  return lines;
}
