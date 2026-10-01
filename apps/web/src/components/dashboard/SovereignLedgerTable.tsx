import { Badge, Card, CardBody } from "@/components/ui";

export interface SovereignInvoice {
  id: string;
  referenceMarche: string;
  clientName: string;
  totalTtc: string;
  disputeStatus: "none" | "disputed" | "resolved";
  validatedByAdministration: boolean;
}

export interface SovereignLedgerTableProps {
  invoices: SovereignInvoice[];
}

const TELEMO_PORTAL_URL = (process.env.NEXT_PUBLIC_TELEMO_PORTAL_URL ?? "https://telemo.gov.gn").replace(
  /\/+$/,
  "",
);

export default function SovereignLedgerTable({ invoices }: SovereignLedgerTableProps) {
  return (
    <Card>
      <div className="border-b border-navy-100 bg-navy-50 px-5 py-4">
        <h3 className="font-display text-base font-semibold text-navy-950">Registre des créances publiques</h3>
        <p className="mt-1 text-xs text-navy-600">
          Suivi des références de marché, des visas et des éventuels litiges.
        </p>
      </div>

      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Créances liées aux marchés publics</caption>
            <thead className="bg-navy-50 text-xs font-semibold text-navy-600">
              <tr>
                <th scope="col" className="px-5 py-3">Référence marché (Telemo)</th>
                <th scope="col" className="px-5 py-3">Client</th>
                <th scope="col" className="px-5 py-3 text-right">Montant TTC</th>
                <th scope="col" className="px-5 py-3 text-center">Éligibilité</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center font-mono text-xs text-navy-600">
                    Aucune créance liée à un marché public.
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => {
                  const isDisputed = invoice.disputeStatus === "disputed";
                  const isEligible = invoice.validatedByAdministration && !isDisputed;

                  return (
                    <tr key={invoice.id} className="transition-colors hover:bg-navy-50">
                      <td className="max-w-[240px] px-5 py-3.5 font-mono text-xs font-bold text-navy-950">
                        <a
                          href={`${TELEMO_PORTAL_URL}/${encodeURIComponent(invoice.referenceMarche)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-navy-200 underline-offset-4 hover:text-navy-600"
                        >
                          {invoice.referenceMarche} ↗
                        </a>
                      </td>
                      <td className="max-w-[180px] truncate px-5 py-3.5 text-navy-800">{invoice.clientName}</td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right font-mono text-xs font-bold text-navy-950">
                        {invoice.totalTtc} GNF
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        {isDisputed ? (
                          <Badge tone="amber">Financement gelé</Badge>
                        ) : isEligible ? (
                          <Badge tone="green">Éligible au financement</Badge>
                        ) : (
                          <Badge tone="navy">Visa en attente</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
