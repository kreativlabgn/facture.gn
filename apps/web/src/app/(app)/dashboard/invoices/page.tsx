import type { Metadata } from "next";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { canEmit } from "@/lib/nav";
import { requireSessionToken } from "@/lib/session";
import { listInvoices } from "@/lib/trust-api";
import { ButtonLink } from "@/components/ui";
import { InvoiceTypeFilter } from "./InvoiceTypeFilter";

export const metadata: Metadata = { title: "Factures — facture.gn" };

// Onglet « Factures » de la coquille (ADR-095). L'accueil n'en montre qu'un
// extrait ; cet écran est la liste elle-même.
//
// Pas de pagination : GET /invoices n'accepte aujourd'hui qu'un `take`, sans
// curseur ni compteur total (voir listInvoices). Construire un « page
// suivante » par-dessus un simple take produirait des pages qui se recouvrent
// dès qu'une facture est émise entre deux clics. La limite est donc explicite
// et affichée, plutôt que déguisée en pagination qui mentirait.
const INVOICE_PAGE_SIZE = 100;

export default async function InvoicesPage() {
  const token = await requireSessionToken();
  const { active: organization } = await resolveActiveOrganization(token);
  if (!organization) {
    return null;
  }

  const invoices = await listInvoices(token, organization.id, { take: INVOICE_PAGE_SIZE });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-navy-950">Factures</h1>
        {canEmit(organization.role) ? (
          <ButtonLink href="/dashboard/invoices/new" variant="accent" className="hidden md:inline-flex">
            + Émettre une facture
          </ButtonLink>
        ) : null}
      </div>

      <InvoiceTypeFilter
        invoices={invoices}
        emptyMessage="Aucune facture pour le moment."
        href={(invoice) => `/dashboard/invoices/${invoice.id}`}
      />

      {invoices.length === INVOICE_PAGE_SIZE ? (
        <p className="mt-3 text-center text-xs text-navy-600">
          Les {INVOICE_PAGE_SIZE} factures les plus récentes. L&apos;historique complet s&apos;exporte depuis
          Paramètres (FEC).
        </p>
      ) : null}
    </div>
  );
}
