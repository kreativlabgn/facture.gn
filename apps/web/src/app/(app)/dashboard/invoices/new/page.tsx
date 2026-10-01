import type { Metadata } from "next";
import { requireSessionToken } from "@/lib/session";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { listCustomers, TrustApiError } from "@/lib/trust-api";
import { EmptyState } from "@/components/ui";
import { InvoiceForm } from "./InvoiceForm";

export const metadata: Metadata = { title: "Émettre une facture — facture.gn" };

export default async function NewInvoicePage() {
  const token = await requireSessionToken();
  const { active: organization } = await resolveActiveOrganization(token);
  if (!organization) {
    return null;
  }

  // Un rôle sans customers:read (URL atteinte directement, hors des liens que
  // la coquille propose) se prend un 403 de trust-api — même défense en
  // profondeur que credits/abonnement/parrainage plutôt qu'une page en erreur.
  let customers;
  try {
    customers = await listCustomers(token, organization.id, { take: 100 });
  } catch (error) {
    if (error instanceof TrustApiError && error.status === 403) {
      return (
        <EmptyState
          title="Accès réservé"
          description="Votre rôle ne permet pas de consulter la liste des clients, nécessaire pour émettre une facture."
        />
      );
    }
    throw error;
  }

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-navy-950">Émettre une facture</h1>
      <InvoiceForm customers={customers} />
    </div>
  );
}
