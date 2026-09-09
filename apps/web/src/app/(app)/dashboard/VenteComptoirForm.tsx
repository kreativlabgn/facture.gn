"use client";

import { useActionState, useMemo, useState } from "react";
import { Button, Card } from "@/components/ui";
import {
  createAndIssueInvoiceAction,
  type CreateInvoiceActionState,
} from "./invoices/new/actions";

// ── Vente au comptoir (ADR-106) ─────────────────────────────────────────────
//
// L'écran d'émission complet demande un client, un type de document, des
// lignes. Au comptoir, il n'y a ni le temps ni l'information : un numéro dicté,
// un article, un montant, et le client suivant attend déjà.
//
// Ce bloc REUTILISE la Server Action de l'émission complète — jamais une
// seconde qui ferait le même travail à côté : deux chemins d'écriture pour une
// facture finiraient par diverger, et c'est le document légal qui en paierait
// le prix. Il ne fait que pré-remplir ce que l'autre écran demande en entier.
//
// Le numéro est FACULTATIF ici : une vente au comptoir se règle souvent sans
// que le client donne quoi que ce soit, et exiger un numéro pour encaisser
// 15 000 GNF de riz remettrait exactement la friction qu'on retire.

export function VenteComptoirForm() {
  const [state, formAction, pending] = useActionState<CreateInvoiceActionState, FormData>(
    createAndIssueInvoiceAction,
    null,
  );
  const [designation, setDesignation] = useState("");
  const [montantGnf, setMontantGnf] = useState("");

  // Une seule ligne, quantité 1 : le montant saisi EST le prix. La conversion
  // en centimes reste dans l'action (comme pour l'écran complet) — la faire
  // ici aussi la placerait à deux endroits.
  const linesJson = useMemo(() => {
    const prix = Number(montantGnf) || 0;
    if (!designation.trim() || prix <= 0) return "[]";
    return JSON.stringify([{ description: designation.trim(), quantity: 1, unitPriceGnf: prix }]);
  }, [designation, montantGnf]);

  const pret = linesJson !== "[]";

  return (
    <Card className="mb-6">
      <form action={formAction} className="p-5">
        <input type="hidden" name="linesJson" value={linesJson} />
        <input type="hidden" name="documentType" value="invoice" />

        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-navy-950">Vente au comptoir</h2>
          <p className="text-xs text-navy-600">Émise et certifiée immédiatement.</p>
        </div>

        {/* Une seule rangée sur écran large, empilée sur téléphone : c'est le
            format où le geste tient sous le pouce, sans défilement. */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
          <Champ
            id="vente-designation"
            label="Article"
            value={designation}
            onChange={setDesignation}
            placeholder="Sac de riz 25 kg"
          />
          <Champ
            id="vente-montant"
            label="Montant (GNF)"
            value={montantGnf}
            onChange={setMontantGnf}
            placeholder="85000"
            type="number"
            mono
          />
          <div>
            <label
              htmlFor="customerPhone"
              className="mb-1.5 block font-sans text-[11px] font-semibold tracking-wide text-navy-950 uppercase"
            >
              Téléphone <span className="text-navy-600">(facultatif)</span>
            </label>
            <input
              id="customerPhone"
              name="customerPhone"
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="622 00 00 00"
              className="min-h-[44px] w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 font-mono text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="accent" disabled={!pret || pending} className="w-full sm:w-auto">
              {pending ? "Émission…" : "Encaisser"}
            </Button>
          </div>
        </div>

        <p className="mt-2 text-xs text-navy-600">
          Sans numéro, la facture reste anonyme. Avec, le client est retrouvé s&apos;il existe déjà —
          jamais dupliqué.
        </p>

        {state ? (
          <p role="status" className="mt-2 text-sm text-bad-text">
            {state.error}
          </p>
        ) : null}
      </form>
    </Card>
  );
}

function Champ({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  mono = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (valeur: string) => void;
  placeholder: string;
  type?: "text" | "number";
  mono?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-sans text-[11px] font-semibold tracking-wide text-navy-950 uppercase"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        inputMode={type === "number" ? "numeric" : undefined}
        min={type === "number" ? 1 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`min-h-[44px] w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
