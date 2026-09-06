import type { Metadata } from "next";
import { requireSessionToken } from "@/lib/session";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { listCustomers } from "@/lib/trust-api";
import { InvoiceForm } from "./InvoiceForm";

export const metadata: Metadata = { title: "Émettre une facture — facture.gn" };

export default async function NewInvoicePage() {
  const token = await requireSessionToken();
  const { active: organization } = await resolveActiveOrganization(token);
  if (!organization) {
    return null;
  }

  const customers = await listCustomers(token, organization.id, { take: 100 });

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-navy-950">Émettre une facture</h1>
      <InvoiceForm customers={customers} />
    </div>
  );
}
