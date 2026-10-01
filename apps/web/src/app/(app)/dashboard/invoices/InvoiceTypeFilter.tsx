"use client";

import { useMemo, useState } from "react";
import type { InvoiceListItem } from "@/lib/trust-api";
import { InvoiceList } from "@/components/data/InvoiceList";

type Filtre = "all" | "invoice" | "quote";

const OPTIONS: { valeur: Filtre; label: string }[] = [
  { valeur: "all", label: "Tous" },
  { valeur: "invoice", label: "Factures" },
  { valeur: "quote", label: "Devis" },
];

// Filtre "Tous / Factures / Devis" — G, décision produit déjà actée (voir
// docs/plans/2026-09-13-devis-document-preliminaire.md) : GET /invoices est
// déjà plafonné à `take=100` sans pagination, filtrer côté client un tableau
// déjà en mémoire est strictement suffisant et n'ajoute aucun aller-retour
// réseau. Enveloppe InvoiceList SANS le modifier davantage — mêmes props,
// un tableau simplement pré-filtré en entrée.
export function InvoiceTypeFilter({
  invoices,
  emptyMessage,
  href,
}: {
  invoices: InvoiceListItem[];
  emptyMessage: string;
  href?: (invoice: InvoiceListItem) => string;
}) {
  const [filtre, setFiltre] = useState<Filtre>("all");

  const invoicesFiltrees = useMemo(
    () => (filtre === "all" ? invoices : invoices.filter((invoice) => invoice.documentType === filtre)),
    [invoices, filtre],
  );

  return (
    <div>
      <div role="group" aria-label="Filtrer par type de document" className="mb-3 flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <button
            key={option.valeur}
            type="button"
            aria-pressed={filtre === option.valeur}
            onClick={() => setFiltre(option.valeur)}
            className={`min-h-[36px] rounded-lg border px-3.5 text-sm font-medium transition ${
              filtre === option.valeur
                ? "border-navy-950 bg-navy-50 text-navy-950"
                : "border-navy-200 bg-white text-navy-600 hover:bg-navy-50"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <InvoiceList invoices={invoicesFiltrees} emptyMessage={emptyMessage} href={href} />
    </div>
  );
}
