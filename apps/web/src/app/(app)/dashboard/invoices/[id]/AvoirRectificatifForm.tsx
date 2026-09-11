"use client";

import { useActionState, useMemo, useState } from "react";
import { formatGnf, uniteDeSaisie } from "@/lib/format";
import type { InvoiceLineItem } from "@/lib/trust-api";
import { Button } from "@/components/ui";
import { createCreditNoteAction, type InvoiceActionState } from "./actions";

// Le module d'avoir rectificatif, ouvert depuis le bloc « Litige ».
//
// Une facture émise est IMMUABLE : on ne la corrige pas, on lui oppose un
// second document. Le formulaire demande donc ce qu'un avoir demande — QUELLES
// lignes, COMBIEN d'unités, et POURQUOI — jamais un montant : trust-api le
// calcule depuis le prix unitaire scellé de la facture. Laisser saisir une
// somme ici en ferait une valeur de confiance externe, et l'avoir cesserait
// d'être adossé au document qu'il corrige.
//
// Replié par défaut : un litige ouvert n'appelle pas forcément un avoir (le
// désaccord peut se régler par une discussion). Déplier est un geste, émettre
// en est un second.
export function AvoirRectificatifForm({
  invoiceId,
  lignes,
}: {
  invoiceId: string;
  lignes: InvoiceLineItem[];
}) {
  const [state, formAction, pending] = useActionState<InvoiceActionState, FormData>(
    createCreditNoteAction,
    null,
  );
  const [ouvert, setOuvert] = useState(false);
  // Une quantité par ligne, saisie en chaîne : un champ vide n'est pas un zéro,
  // et le forcer à 0 ferait remonter le curseur au milieu d'une saisie.
  const [quantites, setQuantites] = useState<Record<string, string>>({});

  const retenues = useMemo(
    () =>
      lignes
        .map((ligne) => ({ ligne, quantite: Number(quantites[ligne.id] ?? "") || 0 }))
        // Une quantité rendue ne peut pas dépasser la quantité facturée : le
        // serveur le refuse (ADR-040, « niveau ligne »), et laisser passer la
        // saisie ferait afficher un total d'avoir supérieur à la facture.
        .filter(({ ligne, quantite }) => quantite > 0 && quantite <= ligne.quantity),
    [lignes, quantites],
  );

  // Projection, jamais le montant définitif : le serveur recalcule depuis le
  // prix unitaire scellé. Les deux coïncident — c'est la même multiplication —
  // mais c'est celui du serveur qui fait foi, et le libellé le dit.
  const totalProjete = useMemo(
    () =>
      retenues
        .reduce((somme, { ligne, quantite }) => somme + BigInt(ligne.unitPrice) * BigInt(quantite), BigInt(0))
        .toString(),
    [retenues],
  );

  const linesJson = useMemo(
    () =>
      JSON.stringify(
        retenues.map(({ ligne, quantite }) => ({
          invoiceLineId: ligne.id,
          quantityReturned: quantite,
        })),
      ),
    [retenues],
  );

  if (!ouvert) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOuvert(true)}>
        Établir un avoir rectificatif
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="linesJson" value={linesJson} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-navy-100 text-left">
              <th className="py-2 pr-4 text-xs font-semibold tracking-wide text-navy-600 uppercase">
                Ligne
              </th>
              <th className="py-2 pr-4 text-right text-xs font-semibold tracking-wide text-navy-600 uppercase">
                Facturé
              </th>
              <th className="py-2 text-right text-xs font-semibold tracking-wide text-navy-600 uppercase">
                À créditer
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {lignes.map((ligne) => (
              <tr key={ligne.id}>
                <td className="py-2.5 pr-4 text-navy-950">
                  {ligne.description}
                  <span className="ml-2 font-mono text-xs text-navy-600">
                    {formatGnf(ligne.unitPrice)}
                    {uniteDeSaisie([ligne])}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-navy-600">
                  {ligne.quantity}
                </td>
                <td className="py-2.5 text-right">
                  <label className="sr-only" htmlFor={`avoir-${ligne.id}`}>
                    Quantité à créditer pour {ligne.description}
                  </label>
                  <input
                    id={`avoir-${ligne.id}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={ligne.quantity}
                    step={1}
                    value={quantites[ligne.id] ?? ""}
                    onChange={(event) =>
                      setQuantites((prev) => ({ ...prev, [ligne.id]: event.target.value }))
                    }
                    placeholder="0"
                    className="min-h-[44px] w-20 rounded-lg border border-navy-200 bg-white px-2.5 py-2 text-right font-mono text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <label
          htmlFor="avoir-reason"
          className="mb-1.5 block font-sans text-[11px] font-semibold tracking-wide text-navy-950 uppercase"
        >
          Motif de l&apos;avoir
        </label>
        <input
          id="avoir-reason"
          name="reason"
          required
          maxLength={200}
          placeholder="Marchandise retournée, erreur de quantité…"
          className="min-h-[44px] w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none"
        />
        <p className="mt-1 text-xs text-navy-600">
          Ce motif figure sur le document remis au client et au journal de la facture.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy-100 pt-3">
        <p className="text-sm text-navy-600">
          Montant projeté&nbsp;:{" "}
          <span className="font-mono font-bold text-navy-950">{formatGnf(totalProjete)}</span>
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => setOuvert(false)}>
            Annuler
          </Button>
          <Button type="submit" variant="accent" disabled={pending || retenues.length === 0}>
            {pending ? "Émission…" : "Émettre l'avoir"}
          </Button>
        </div>
      </div>

      {state ? (
        <p
          role="status"
          className={`text-sm ${"error" in state ? "text-bad-text" : "text-good-text"}`}
        >
          {"error" in state ? state.error : state.ok}
        </p>
      ) : null}
    </form>
  );
}
