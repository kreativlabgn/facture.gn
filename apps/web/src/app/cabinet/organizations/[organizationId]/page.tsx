import type { Metadata } from "next";
import Link from "next/link";
import { requireSessionToken } from "@/lib/session";
import {
  listOrganizationCustomersForCabinet,
  listOrganizationInvoicesForCabinet,
  TrustApiError,
} from "@/lib/trust-api";
import { formatDate, formatGnf } from "@/lib/format";
import { StatusPill } from "@/components/StatusPill";

type Params = { organizationId: string };

export const metadata: Metadata = { title: "Organisation cliente — facture.gn" };

// Aucune donnée de nom d'organisation chargée ici (pas d'endpoint dédié
// "détail organisation vue du cabinet" — GET /organizations/:id est réservé
// owner/admin de l'organisation elle-même, voir settings/page.tsx) — même
// discipline que le reste du repo, pas de donnée inventée. Le lien "Voir"
// depuis cabinet/page.tsx porte déjà le nom, cette page se contente de
// l'identifiant technique en repère.
export default async function CabinetClientOrganizationPage({ params }: { params: Promise<Params> }) {
  const { organizationId } = await params;
  const token = await requireSessionToken();

  let invoices;
  let customers;
  try {
    [invoices, customers] = await Promise.all([
      listOrganizationInvoicesForCabinet(token, organizationId),
      listOrganizationCustomersForCabinet(token, organizationId),
    ]);
  } catch (error) {
    if (error instanceof TrustApiError && error.status === 403) {
      return (
        <div className="rounded-2xl border border-navy-100 bg-white p-8 text-center">
          <p className="font-display text-lg font-bold text-navy-950">Accès réservé</p>
          <p className="mx-auto mt-3 max-w-sm text-sm text-navy-600">
            Vous n&apos;avez ni mandat actif ni rôle habilité sur cette organisation.
          </p>
        </div>
      );
    }
    throw error;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-navy-950">Organisation cliente</h1>
        <div className="flex items-center gap-4">
          <Link
            href={`/cabinet/organizations/${organizationId}/fec`}
            className="rounded-[10px] bg-navy-950 px-5 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-navy-800"
          >
            Télécharger le FEC
          </Link>
          <Link href="/cabinet" className="text-sm font-medium text-navy-600 hover:text-navy-950">
            ← Retour
          </Link>
        </div>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 font-display text-sm font-semibold text-navy-950">Factures</h2>
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
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold text-navy-950">Clients</h2>
        <div className="rounded-2xl border border-navy-100 bg-white">
          {customers.length === 0 ? (
            <p className="p-8 text-center text-sm text-navy-600">Aucun client pour le moment.</p>
          ) : (
            customers.map((customer, index) => (
              <div
                key={customer.id}
                className={`flex items-center justify-between gap-4 px-5 py-4 ${index === customers.length - 1 ? "" : "border-b border-navy-50"}`}
              >
                <span className="font-semibold text-navy-950">{customer.name}</span>
                <div className="flex gap-4 text-xs text-navy-600">
                  {customer.phone ? <span className="font-mono">{customer.phone}</span> : null}
                  {customer.nif ? <span className="font-mono">NIF {customer.nif}</span> : null}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
