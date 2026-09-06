import { formatDate, formatGnf } from "@/lib/format";
import type { InvoiceListItem } from "@/lib/trust-api";
import { StatusPill } from "@/components/StatusPill";
import { Card } from "@/components/ui";

// Liste de factures, extraite de l'accueil pour être partagée avec l'onglet
// « Factures » et la vue cabinet d'une organisation (trois rendus identiques
// jusqu'ici — règle des trois atteinte).
//
// Une liste et non un DataTable : sur un téléphone, les colonnes d'un tableau
// se compriment jusqu'à l'illisible. Chaque ligne empile numéro + date à
// gauche, montant + statut à droite, et tient à 320px de large.
export function InvoiceList({ invoices, emptyMessage }: { invoices: InvoiceListItem[]; emptyMessage: string }) {
  if (invoices.length === 0) {
    return (
      <Card>
        <p className="p-8 text-center text-sm text-navy-600">{emptyMessage}</p>
      </Card>
    );
  }

  return (
    <Card>
      <ul className="divide-y divide-navy-50">
        {invoices.map((invoice) => (
          <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
            <div className="flex flex-col gap-0.5">
              {/* Le numéro est une donnée déjà certifiée — JetBrains Mono, chasse
                  fixe, pour lever l'ambiguïté 0/O et 1/l à la lecture à voix haute. */}
              <span className="font-mono text-xs text-navy-600">{invoice.number ?? "Brouillon"}</span>
              <span className="text-xs text-navy-600">{formatDate(invoice.createdAt)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-bold text-navy-950">{formatGnf(invoice.totalTtc)}</span>
              <StatusPill status={invoice.status} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
