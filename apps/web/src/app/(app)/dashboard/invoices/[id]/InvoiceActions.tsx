"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import {
  convertToInvoiceAction,
  issueInvoiceAction,
  regeneratePaymentLinkAction,
  sendReminderAction,
  voidInvoiceAction,
  type ConvertToInvoiceActionState,
  type InvoiceActionState,
} from "./actions";

// Les actions de l'écran détail. Un composant client, parce que chaque action
// doit rendre son résultat à l'endroit où on a cliqué — un formulaire nu
// rechargerait la page sans jamais dire ce qui s'est passé.
//
// Chaque action a SON état : afficher « Relance envoyée » sous le bouton
// Annuler serait au mieux déroutant, au pire trompeur.

function Retour({ state }: { state: InvoiceActionState }) {
  if (!state) {
    return null;
  }
  const erreur = "error" in state;
  return (
    <p
      role="status"
      className={`mt-2 text-sm ${erreur ? "text-bad-text" : "text-good-text"}`}
    >
      {erreur ? state.error : state.ok}
    </p>
  );
}

// ── Émission ────────────────────────────────────────────────────────────────
// Irréversible : le hash est scellé et un numéro de séquence légal est
// consommé. Case à cocher explicite, même précédent que la fusion de clients
// (MergeDuplicateForm) — le seul autre geste irréversible de la coquille.
export function IssueInvoiceForm({ invoiceId }: { invoiceId: string }) {
  const [state, formAction, pending] = useActionState<InvoiceActionState, FormData>(
    issueInvoiceAction,
    null,
  );
  const [confirme, setConfirme] = useState(false);

  return (
    <form action={formAction}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <label className="flex items-start gap-2.5 text-sm text-navy-700">
        <input
          type="checkbox"
          checked={confirme}
          onChange={(event) => setConfirme(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-navy-950"
        />
        <span>
          Je confirme l&apos;émission. La facture recevra un numéro légal et son empreinte sera
          scellée — elle ne pourra plus être modifiée.
        </span>
      </label>
      <div className="mt-3">
        <Button type="submit" variant="accent" disabled={!confirme || pending}>
          {pending ? "Émission…" : "Émettre et certifier"}
        </Button>
      </div>
      <Retour state={state} />
    </form>
  );
}

// ── Conversion en facture (C15/C16, ADR-064) ────────────────────────────────
// Calqué sur IssueInvoiceForm : même case à cocher de confirmation, même
// forme. La différence est dans le useEffect — la Server Action reste pure
// (jamais de redirect() serveur, même précédent que InvoiceForm.tsx) : c'est
// ce composant client qui redirige, dès que l'état porte l'identifiant de la
// nouvelle facture brouillon créée.
export function ConvertToInvoiceForm({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ConvertToInvoiceActionState, FormData>(
    convertToInvoiceAction,
    null,
  );
  const [confirme, setConfirme] = useState(false);

  useEffect(() => {
    if (state && "newInvoiceId" in state) {
      router.push(`/dashboard/invoices/${state.newInvoiceId}`);
    }
  }, [state, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <label className="flex items-start gap-2.5 text-sm text-navy-700">
        <input
          type="checkbox"
          checked={confirme}
          onChange={(event) => setConfirme(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-navy-950"
        />
        <span>
          Je confirme la conversion. Une nouvelle facture brouillon sera créée à partir de ce
          document ; celui-ci restera consultable, marqué « Convertie ».
        </span>
      </label>
      <div className="mt-3">
        <Button type="submit" variant="accent" disabled={!confirme || pending}>
          {pending ? "Conversion…" : "Convertir en facture"}
        </Button>
      </div>
      {state && "error" in state ? (
        <p role="status" className="mt-2 text-sm text-bad-text">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

// ── Annulation ──────────────────────────────────────────────────────────────
// Une facture émise porte un numéro de séquence légal : l'annuler laisse un
// trou justifié dans la séquence, pas une facture effacée. Confirmation
// explicite pour la même raison que l'émission.
export function VoidInvoiceForm({ invoiceId }: { invoiceId: string }) {
  const [state, formAction, pending] = useActionState<InvoiceActionState, FormData>(
    voidInvoiceAction,
    null,
  );
  const [confirme, setConfirme] = useState(false);

  return (
    <form action={formAction}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <label className="flex items-start gap-2.5 text-sm text-navy-700">
        <input
          type="checkbox"
          name="confirmed"
          checked={confirme}
          onChange={(event) => setConfirme(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-navy-950"
        />
        <span>
          Je confirme l&apos;annulation. La facture reste visible et conserve son numéro : elle est
          marquée annulée, jamais supprimée.
        </span>
      </label>
      <div className="mt-3">
        <Button type="submit" variant="secondary" disabled={!confirme || pending}>
          {pending ? "Annulation…" : "Annuler la facture"}
        </Button>
      </div>
      <Retour state={state} />
    </form>
  );
}

// ── Relance ─────────────────────────────────────────────────────────────────
// Réversible et répétable : aucune confirmation. Chaque envoi laisse une trace
// payment_reminder_sent dans le journal, qui est le vrai garde-fou contre le
// harcèlement involontaire — le commerçant voit ce qu'il a déjà envoyé.
export function SendReminderForm({ invoiceId }: { invoiceId: string }) {
  const [state, formAction, pending] = useActionState<InvoiceActionState, FormData>(
    sendReminderAction,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Envoi…" : "Relancer le client"}
      </Button>
      <Retour state={state} />
    </form>
  );
}

// ── Lien de paiement ────────────────────────────────────────────────────────
// Régénérer invalide le lien précédent. Réversible dans les faits (on peut en
// régénérer un autre), donc pas de confirmation ; le libellé dit ce qui arrive.
export function RegenerateLinkForm({ invoiceId, existant }: { invoiceId: string; existant: boolean }) {
  const [state, formAction, pending] = useActionState<InvoiceActionState, FormData>(
    regeneratePaymentLinkAction,
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Génération…" : existant ? "Régénérer le lien" : "Générer un lien de paiement"}
      </Button>
      {existant ? (
        <p className="mt-2 text-xs text-navy-600">Le lien actuel cessera de fonctionner.</p>
      ) : null}
      <Retour state={state} />
    </form>
  );
}
