"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { PublicBuyerInvoice } from "@/lib/trust-api";
import { leverObjectionAction, validerLiquidationAction } from "@/app/admin/b2g/actions";

export interface DafVerificationZoneProps {
  invoice: Pick<PublicBuyerInvoice, "id" | "number" | "referenceMarche" | "validatedByAdministration" | "disputeStatus">;
}

type Feedback = { success: boolean; message: string } | null;

export default function DafVerificationZone({ invoice }: DafVerificationZoneProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [actionCompleted, setActionCompleted] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [objectionReason, setObjectionReason] = useState("");

  const reference = invoice.referenceMarche ?? invoice.number ?? invoice.id;
  const objectionReady = objectionReason.trim().length >= 10;
  const isClosed =
    actionCompleted || invoice.validatedByAdministration || invoice.disputeStatus === "disputed";

  function handleValidate() {
    setFeedback(null);
    startTransition(async () => {
      const result = await validerLiquidationAction({ invoiceId: invoice.id });
      if (result.success) {
        setActionCompleted(true);
      }
      setFeedback(
        result.success ? { success: true, message: result.message } : { success: false, message: result.error },
      );
    });
  }

  function handleObjectionSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = objectionReason.trim();
    if (reason.length < 10) {
      return;
    }

    setIsModalOpen(false);
    setFeedback(null);
    startTransition(async () => {
      const result = await leverObjectionAction({ invoiceId: invoice.id, reason });
      if (result.success) {
        setActionCompleted(true);
      }
      setFeedback(
        result.success ? { success: true, message: result.message } : { success: false, message: result.error },
      );
      if (result.success) {
        setObjectionReason("");
      }
    });
  }

  return (
    <section className="relative border-t border-navy-100 pt-4" aria-labelledby={`verification-${invoice.id}`}>
      <div className="mb-4">
        <h3 id={`verification-${invoice.id}`} className="font-display text-base font-semibold text-navy-950">
          Vérification de la dépense
        </h3>
        <p className="mt-1 text-xs text-navy-600">Référence : {reference}</p>
      </div>

      {feedback ? (
        <div
          className={`mb-4 rounded-lg border p-3 text-xs font-medium ${
            feedback.success
              ? "border-green-200 bg-green-bg text-green-text"
              : "border-amber-200 bg-amber-bg text-amber-text"
          }`}
          role={feedback.success ? "status" : "alert"}
          aria-live={feedback.success ? "polite" : "assertive"}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={isPending || isClosed}
          onClick={() => setIsModalOpen(true)}
          aria-label={`Enregistrer une objection pour ${reference}`}
        >
          Enregistrer une objection
        </Button>
        <Button
          type="button"
          disabled={isPending || isClosed}
          onClick={handleValidate}
          aria-label={`Viser le service fait pour ${reference}`}
        >
          {isPending ? "Traitement en cours..." : "Viser le service fait"}
        </Button>
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/40 p-4" role="presentation">
          <div
            className="w-full max-w-md rounded-lg border border-navy-200 bg-white p-6 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`objection-title-${invoice.id}`}
            aria-describedby={`objection-description-${invoice.id}`}
          >
            <h4 id={`objection-title-${invoice.id}`} className="font-display text-lg font-semibold text-navy-950">
              Enregistrer une objection
            </h4>
            <p id={`objection-description-${invoice.id}`} className="mt-1 text-sm text-navy-600">
              Décrivez le motif du litige. La créance ne pourra plus être proposée au financement tant que le litige est ouvert.
            </p>

            <div className="mt-4 rounded-md border border-amber-200 bg-amber-bg p-3 text-xs font-medium text-amber-text">
              Cette action gèle immédiatement la cessibilité de la créance.
            </div>

            <div aria-live="polite" className="sr-only">
              {feedback?.message}
            </div>

            <form onSubmit={handleObjectionSubmit} className="mt-4 space-y-4">
              <label htmlFor={`objection-reason-${invoice.id}`} className="block text-sm font-semibold text-navy-950">
                Motif de l&apos;objection
              </label>
              <textarea
                id={`objection-reason-${invoice.id}`}
                value={objectionReason}
                onChange={(event) => setObjectionReason(event.target.value)}
                placeholder="Décrivez le motif du litige (10 caractères minimum)."
                rows={4}
                maxLength={1000}
                required
                className="w-full resize-none rounded-md border border-navy-200 bg-white p-3 text-sm text-navy-950 focus:border-navy-950 focus:outline-none focus:ring-2 focus:ring-navy-200"
              />
              <div className="flex flex-wrap justify-end gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setIsModalOpen(false);
                    setObjectionReason("");
                  }}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={!objectionReady || isPending}>
                  Confirmer l&apos;objection
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
