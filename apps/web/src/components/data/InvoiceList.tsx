import Link from "next/link";
import { formatDate, formatGnf } from "@/lib/format";
import type { InvoiceListItem } from "@/lib/trust-api";
import { DocumentTypeBadge, StatusPill } from "@/components/StatusPill";
import { LifecyclePills } from "@/components/LifecyclePills";
import { Card } from "@/components/ui";

// Liste de factures, extraite de l'accueil pour être partagée avec l'onglet
// « Factures » et la vue cabinet d'une organisation (trois rendus identiques
// jusqu'ici — règle des trois atteinte).
//
// Une liste et non un DataTable : sur un téléphone, les colonnes d'un tableau
// se compriment jusqu'à l'illisible. Chaque ligne empile numéro + date à
// gauche, montant + statut à droite, et tient à 320px de large.
//
// `href` optionnel : la vue cabinet consulte les factures d'une organisation
// cliente sans avoir d'écran de détail à lui offrir (le détail vit sous
// /dashboard, côté PME). Sans lien, la liste reste une liste — plutôt que de
// proposer une navigation qui finirait en 404.
export function InvoiceList({
  invoices,
  emptyMessage,
  href,
}: {
  invoices: InvoiceListItem[];
  emptyMessage: string;
  href?: (invoice: InvoiceListItem) => string;
}) {
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
        {invoices.map((invoice) => {
          const contenu = (
            <>
              <div className="flex flex-col gap-0.5">
                {/* Le numéro est une donnée déjà certifiée — JetBrains Mono, chasse
                    fixe, pour lever l'ambiguïté 0/O et 1/l à la lecture à voix haute. */}
                <span className="font-mono text-xs text-navy-600">{invoice.number ?? "Brouillon"}</span>
                <span className="text-xs text-navy-600">{formatDate(invoice.createdAt)}</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
                <span className="font-mono text-sm font-bold text-navy-950">{formatGnf(invoice.totalTtc)}</span>
                <StatusPill status={invoice.status} />
                <DocumentTypeBadge documentType={invoice.documentType} />
                {/* Le parcours légal se lit À CÔTÉ du statut de document, jamais
                    à sa place : « Payée » et « Déposée » ne répondent pas à la
                    même question. Le retour à la ligne est autorisé — sur un
                    téléphone, quatre pastilles passent dessous plutôt que de
                    comprimer le montant jusqu'à l'illisible. */}
                <LifecyclePills facture={invoice} />
              </div>
            </>
          );
          const classes = "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4";
          return (
            <li key={invoice.id}>
              {href ? (
                <Link
                  href={href(invoice)}
                  className={`${classes} transition-colors hover:bg-navy-50 focus-visible:bg-navy-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy-950`}
                >
                  {contenu}
                </Link>
              ) : (
                <div className={classes}>{contenu}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
