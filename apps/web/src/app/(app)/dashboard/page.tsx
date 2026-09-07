import type { Metadata } from "next";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { deriveInvoiceWindowKpis, formatVerifiedPaymentRatio } from "@/lib/kpi";
import { formatGnf } from "@/lib/format";
import { canEmit } from "@/lib/nav";
import { hasPermission } from "@/lib/permissions";
import { requireSessionToken } from "@/lib/session";
import { TrustApiError, getTrustScore, listInvoices } from "@/lib/trust-api";
import { InvoiceList } from "@/components/data/InvoiceList";
import { KpiRow, type Kpi } from "@/components/data/KpiRow";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "Accueil — facture.gn" };

// Fenêtre de factures chargée par l'accueil. Elle sert DEUX choses : la liste
// affichée (tronquée à HOME_LIST_SIZE) et les compteurs de KpiRow. Faute
// d'endpoint d'agrégation côté trust-api (voir lib/kpi.ts), les compteurs ne
// portent que sur cette fenêtre — d'où la portée écrite noir sur blanc sous
// chaque tuile plutôt qu'un total qui n'en serait pas un.
const HOME_INVOICE_WINDOW = 20;
const HOME_LIST_SIZE = 8;

export default async function DashboardHomePage() {
  const token = await requireSessionToken();
  const { active: organization } = await resolveActiveOrganization(token);
  if (!organization) {
    return null;
  }

  const invoices = await listInvoices(token, organization.id, { take: HOME_INVOICE_WINDOW });
  const windowKpis = deriveInvoiceWindowKpis(invoices);

  const kpis: Kpi[] = [
    {
      label: "Encours",
      value: formatGnf(windowKpis.totalTtcCentimes),
      scope: `Sur les ${windowKpis.windowSize} dernières factures`,
    },
    {
      label: "En attente",
      value: String(windowKpis.awaitingPaymentCount),
      scope: `Sur les ${windowKpis.windowSize} dernières factures`,
    },
  ];

  // Le SEUL agrégat réel du domaine (E8) — calculé côté trust-api sur toute
  // l'organisation, pas sur une fenêtre. Réservé owner/admin, d'où le test de
  // permission : proposer la tuile à un caissier lui vaudrait un 403 et une
  // page en erreur pour un chiffre décoratif.
  if (hasPermission(organization.role, "organization:trust_score")) {
    const trustScore = await getTrustScore(token, organization.id).catch((error: unknown) => {
      // Une tuile de plus ne justifie pas de faire tomber l'accueil : sans
      // elle, la page reste exacte, simplement plus courte.
      if (error instanceof TrustApiError) {
        return null;
      }
      throw error;
    });
    if (trustScore) {
      kpis.push({
        label: "Paiements vérifiés",
        value: formatVerifiedPaymentRatio(trustScore.ratio),
        scope: "Toute l'organisation",
      });
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-navy-950">Accueil</h1>
        {/* Le FAB de la barre basse porte déjà l'action sur téléphone — ce CTA
            est son équivalent sur écran large, où il n'y a pas de barre. */}
        {canEmit(organization.role) ? (
          <ButtonLink href="/dashboard/invoices/new" variant="accent" className="hidden md:inline-flex">
            + Émettre une facture
          </ButtonLink>
        ) : null}
      </div>

      <KpiRow items={kpis} />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-navy-950">Factures récentes</h2>
        {invoices.length > HOME_LIST_SIZE ? (
          <ButtonLink href="/dashboard/invoices" variant="ghost" className="min-h-0 px-2 py-1 text-xs">
            Voir tout
          </ButtonLink>
        ) : null}
      </div>

      <InvoiceList
        invoices={invoices.slice(0, HOME_LIST_SIZE)}
        emptyMessage="Aucune facture pour le moment."
        href={(invoice) => `/dashboard/invoices/${invoice.id}`}
      />
    </div>
  );
}
