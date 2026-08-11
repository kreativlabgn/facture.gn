import Link from "next/link";
import { requireSessionToken } from "@/lib/session";
import { listInvoices, listMyOrganizations } from "@/lib/trust-api";
import { formatDate, formatGnf } from "@/lib/format";
import { StatusPill } from "@/components/StatusPill";

// Pas de stat-cards (taux d'encaissement, encaissé ce mois, ...) dans cette
// passe — aucun endpoint d'agrégation n'existe côté trust-api (voir blueprint
// dashboard : "Les 4 stat-cards... sont hors scope de cette story, demandent
// une vraie agrégation SQL"). Uniquement la liste réelle des factures.
export default async function DashboardHomePage() {
  const token = await requireSessionToken();
  const organizations = await listMyOrganizations(token);
  const organization = organizations[0];
  if (!organization) {
    return null;
  }

  const invoices = await listInvoices(token, organization.id, { take: 10 });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-navy-950">Factures récentes</h1>
        <Link
          href="/dashboard/invoices/new"
          className="rounded-[10px] bg-yellow px-5 py-2.5 font-display text-sm font-semibold text-navy-950 transition hover:brightness-95"
        >
          + Émettre une facture
        </Link>
      </div>

      <div className="rounded-2xl border border-navy-100 bg-white">
        {invoices.length === 0 ? (
          <p className="p-8 text-center text-sm text-navy-600">Aucune facture pour le moment.</p>
        ) : (
          invoices.map((invoice, index) => (
            <div
              key={invoice.id}
              className={`flex items-center justify-between gap-4 px-5 py-4 ${index === invoices.length - 1 ? "" : "border-b border-navy-50"}`}
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-xs text-navy-600">{invoice.number ?? "Brouillon"}</span>
                <span className="text-xs text-navy-400">{formatDate(invoice.createdAt)}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold text-navy-950">{formatGnf(invoice.totalTtc)}</span>
                <StatusPill status={invoice.status} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
