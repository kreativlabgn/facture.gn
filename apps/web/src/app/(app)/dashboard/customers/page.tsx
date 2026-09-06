import type { Metadata } from "next";
import Link from "next/link";
import { requireSessionToken } from "@/lib/session";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { listCustomers, type CustomerListItem } from "@/lib/trust-api";
import { DuplicateWarningPill } from "@/components/StatusPill";
import { DataTable, type Column } from "@/components/data/DataTable";
import { NewCustomerForm } from "./NewCustomerForm";

export const metadata: Metadata = { title: "Clients — facture.gn" };

// Le lien vit dans la cellule « Client » et non sur la ligne entière — voir la
// même note sur l'écran Produits : une <tr> cliquable n'est ni annoncée comme
// un lien ni utilisable au clavier.
const COLUMNS: readonly Column<CustomerListItem>[] = [
  {
    key: "name",
    header: "Client",
    cell: (customer) => (
      <span className="flex flex-wrap items-center gap-2">
        <Link
          href={`/dashboard/customers/${customer.id}`}
          className="font-semibold text-navy-950 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
        >
          {customer.name}
        </Link>
        {customer.possibleDuplicateOf ? <DuplicateWarningPill /> : null}
      </span>
    ),
  },
  {
    key: "phone",
    header: "Téléphone",
    // Chasse fixe : un numéro se relit chiffre à chiffre, souvent à voix haute.
    cell: (customer) => <span className="font-mono text-xs text-navy-600">{customer.phone ?? "—"}</span>,
  },
  {
    key: "nif",
    header: "NIF",
    cell: (customer) => <span className="font-mono text-xs text-navy-600">{customer.nif ?? "—"}</span>,
  },
];

export default async function CustomersPage() {
  const token = await requireSessionToken();
  const { active: organization } = await resolveActiveOrganization(token);
  if (!organization) {
    return null;
  }

  const customers = await listCustomers(token, organization.id, { take: 100 });

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-navy-950">Clients</h1>
      <div className="mb-6">
        <DataTable
          columns={COLUMNS}
          rows={customers}
          getRowKey={(customer) => customer.id}
          emptyMessage="Aucun client pour le moment."
        />
      </div>
      <NewCustomerForm />
    </div>
  );
}
