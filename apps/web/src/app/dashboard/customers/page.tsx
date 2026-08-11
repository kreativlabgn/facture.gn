import type { Metadata } from "next";
import { requireSessionToken } from "@/lib/session";
import { listCustomers, listMyOrganizations } from "@/lib/trust-api";
import { NewCustomerForm } from "./NewCustomerForm";

export const metadata: Metadata = { title: "Clients — facture.gn" };

export default async function CustomersPage() {
  const token = await requireSessionToken();
  const organizations = await listMyOrganizations(token);
  const organization = organizations[0];
  if (!organization) {
    return null;
  }

  const customers = await listCustomers(token, organization.id, { take: 100 });

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-navy-950">Clients</h1>
      <div className="mb-6 rounded-2xl border border-navy-100 bg-white">
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
      <NewCustomerForm />
    </div>
  );
}
