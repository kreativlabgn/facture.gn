import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSessionToken } from "@/lib/session";
import { getCustomer, TrustApiError } from "@/lib/trust-api";
import { formatGnf } from "@/lib/format";
import { MergeDuplicateForm } from "./MergeDuplicateForm";

type Params = { id: string };

export const metadata: Metadata = { title: "Client — facture.gn" };

// E4/E9, ADR-038 — écran détail client (gap produit comblé ici) : affiche les
// informations du client et, si possibleDuplicateOf est renseigné, une
// section dédiée pour résoudre le doublon (fusion via MergeDuplicateForm).
// Pas de vérification manuelle d'organisation ici — GET /customers/:id est
// déjà scopé par @OrganizationIdSource("customer") + RolesGuard côté
// trust-api (403/404 relayés tels quels par TrustApiError).
export default async function CustomerDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const token = await requireSessionToken();

  let customer;
  try {
    customer = await getCustomer(token, id);
  } catch (error) {
    if (error instanceof TrustApiError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-navy-950">{customer.name}</h1>
        <Link href="/dashboard/customers" className="text-sm font-medium text-navy-600 hover:text-navy-950">
          ← Retour
        </Link>
      </div>

      <dl className="mb-6 space-y-3 rounded-2xl border border-navy-100 bg-white p-5">
        <Row label="Téléphone" value={customer.phone ?? "—"} />
        <Row label="NIF" value={customer.nif ?? "—"} />
        <Row label="Limite de crédit" value={customer.creditLimit ? formatGnf(customer.creditLimit) : "—"} />
        <Row label="Solde dû" value={formatGnf(customer.runningBalance)} bold />
      </dl>

      {customer.possibleDuplicateOf && customer.duplicateOf ? (
        <MergeDuplicateForm
          canonicalCustomerId={customer.id}
          canonicalCustomerName={customer.name}
          duplicateCustomerId={customer.duplicateOf.id}
          duplicateCustomerName={customer.duplicateOf.name}
        />
      ) : null}
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sm text-navy-600">{label}</dt>
      <dd className={`font-mono text-sm ${bold ? "font-bold text-navy-950" : "text-navy-950"}`}>{value}</dd>
    </div>
  );
}
