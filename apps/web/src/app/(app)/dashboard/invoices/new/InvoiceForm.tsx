"use client";

import { useActionState, useMemo, useState } from "react";
import type { CustomerListItem } from "@/lib/trust-api";
import { createAndIssueInvoiceAction, type CreateInvoiceActionState } from "./actions";
import { Button } from "@/components/ui";

interface LineDraft {
  description: string;
  quantity: string;
  unitPriceGnf: string;
}

const EMPTY_LINE: LineDraft = { description: "", quantity: "1", unitPriceGnf: "" };

export function InvoiceForm({ customers }: { customers: CustomerListItem[] }) {
  const [state, formAction, pending] = useActionState<CreateInvoiceActionState, FormData>(
    createAndIssueInvoiceAction,
    null,
  );
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }]);
  // Le choix d'une fiche client l'emporte sur le champ téléphone (voir
  // actions.ts). Le champ est donc neutralisé plutôt que laissé actif à ne
  // rien faire : un champ qu'on remplit sans effet est un piège, pas une
  // liberté.
  const [customerId, setCustomerId] = useState("");

  const totalGnf = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const qty = Number(line.quantity) || 0;
        const pu = Number(line.unitPriceGnf) || 0;
        return sum + qty * pu;
      }, 0),
    [lines],
  );

  const linesJson = useMemo(
    () =>
      JSON.stringify(
        lines
          .filter((line) => line.description.trim() && Number(line.unitPriceGnf) > 0)
          .map((line) => ({
            description: line.description.trim(),
            quantity: Number(line.quantity) || 1,
            unitPriceGnf: Number(line.unitPriceGnf) || 0,
          })),
      ),
    [lines],
  );

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  return (
    <form action={formAction} className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
      <input type="hidden" name="linesJson" value={linesJson} />

      <div className="rounded-2xl border border-navy-100 bg-white p-5">
        <div className="mb-4">
          <label htmlFor="customerId" className="mb-1.5 block font-sans text-[11px] font-semibold tracking-wide text-navy-950 uppercase">
            Client
          </label>
          <select
            id="customerId"
            name="customerId"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            className="w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none"
          >
            <option value="">Facture anonyme</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        {/* ADR-106 — vente au comptoir : plus besoin d'une fiche client
            complète. Neuf chiffres suffisent ; le client est retrouvé s'il
            existe, créé sinon, sans jamais fabriquer un doublon. */}
        <div className="mb-4">
          <label
            htmlFor="customerPhone"
            className="mb-1.5 block font-sans text-[11px] font-semibold tracking-wide text-navy-950 uppercase"
          >
            Ou numéro de téléphone du client
          </label>
          <input
            id="customerPhone"
            name="customerPhone"
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            disabled={customerId !== ""}
            placeholder="622 00 00 00"
            className="min-h-[44px] w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 font-mono text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none disabled:bg-navy-50 disabled:text-navy-600"
          />
          <p className="mt-1 text-xs text-navy-600">
            {customerId !== ""
              ? "Une fiche client est déjà sélectionnée."
              : "Le client sera retrouvé s'il existe déjà, sinon créé sous ce numéro."}
          </p>
        </div>

        <div className="mb-4">
          <label htmlFor="documentType" className="mb-1.5 block font-sans text-[11px] font-semibold tracking-wide text-navy-950 uppercase">
            Type de document
          </label>
          <select
            id="documentType"
            name="documentType"
            defaultValue="invoice"
            className="w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none"
          >
            <option value="invoice">Facture</option>
            <option value="quote">Devis</option>
          </select>
        </div>

        <div className="mb-4">
          <label htmlFor="referenceMarche" className="mb-1.5 block font-sans text-[11px] font-semibold tracking-wide text-navy-950 uppercase">
            Référence marché (TELEMO) — optionnel
          </label>
          <input
            type="text"
            id="referenceMarche"
            name="referenceMarche"
            placeholder="TELEMO-2026-000123"
            className="w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none"
          />
        </div>

        <div className="mt-5">
          <p className="mb-2 grid grid-cols-[1fr_70px_110px_32px] gap-2 font-sans text-[11px] font-semibold tracking-wide text-navy-600 uppercase">
            <span>Description</span>
            <span>Qté</span>
            <span>P.U. (GNF)</span>
            <span />
          </p>
          {lines.map((line, index) => (
            <div key={index} className="mb-2 grid grid-cols-[1fr_70px_110px_32px] items-center gap-2">
              <input
                type="text"
                value={line.description}
                onChange={(event) => updateLine(index, { description: event.target.value })}
                placeholder="Sac de riz 50kg"
                className="rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none"
              />
              <input
                type="number"
                min={1}
                value={line.quantity}
                onChange={(event) => updateLine(index, { quantity: event.target.value })}
                className="rounded-lg border border-navy-200 bg-white px-2 py-2 text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none"
              />
              <input
                type="number"
                min={0}
                value={line.unitPriceGnf}
                onChange={(event) => updateLine(index, { unitPriceGnf: event.target.value })}
                placeholder="85000"
                className="rounded-lg border border-navy-200 bg-white px-2 py-2 text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => removeLine(index)}
                aria-label="Retirer cette ligne"
                className="text-navy-600 transition hover:text-red-text"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}
            className="mt-2 text-sm font-medium text-navy-600 transition hover:text-navy-950"
          >
            + Ajouter une ligne
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-navy-100 bg-white p-5">
        <p className="mb-3 font-display text-sm font-semibold text-navy-950">Récapitulatif</p>
        <div className="flex justify-between border-t border-navy-50 pt-3 font-display text-base font-bold text-navy-950">
          <span>Total (estimé, HT/taxe calculés à l&apos;émission)</span>
          <span className="font-mono">{totalGnf.toLocaleString("fr-FR")} GNF</span>
        </div>
        {state?.error ? <p className="mt-4 text-sm text-red-text">{state.error}</p> : null}
        <Button type="submit" disabled={pending} size="lg" className="mt-5 w-full">
          {pending ? "Émission..." : "Émettre et certifier"}
        </Button>
        <p className="mt-3 text-xs leading-relaxed text-navy-600">
          Votre facture sera scellée et rattachée à la suite de vos factures : ni elle ni les
          précédentes ne pourront être modifiées après coup.
        </p>
      </div>
    </form>
  );
}
