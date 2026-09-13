"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { formatGnf } from "@/lib/format";
import {
  createAndIssueInvoiceAction,
  type CreateInvoiceActionState,
  type CreateInvoiceSuccess,
  type SettlementMode,
} from "./invoices/new/actions";

// ── Vente au comptoir (ADR-106) ─────────────────────────────────────────────
//
// L'écran d'émission complet demande un client, un type de document, des
// lignes. Au comptoir, il n'y a ni le temps ni l'information : un panier
// d'articles ajoutés un par un, un choix de règlement, et le client suivant
// attend déjà.
//
// Ce bloc REUTILISE la Server Action de l'émission complète — jamais une
// seconde qui ferait le même travail à côté : deux chemins d'écriture pour une
// facture finiraient par diverger, et c'est le document légal qui en paierait
// le prix. Il ne fait que pré-remplir ce que l'autre écran demande en entier,
// et reconstruit `linesJson` depuis un panier plutôt que depuis une ligne
// unique.
//
// Le numéro est FACULTATIF en règlement espèces : une vente au comptoir se
// règle souvent sans que le client donne quoi que ce soit. Il devient
// OBLIGATOIRE pour un lien de paiement — validé côté serveur dans actions.ts,
// pas seulement ici (un POST peut être rejoué sans passer par ce JS).

interface LigneVente {
  description: string;
  quantity: number;
  unitPriceGnf: number;
}

const MODES_REGLEMENT: { valeur: SettlementMode; label: string }[] = [
  { valeur: "cash", label: "Espèces" },
  { valeur: "payment_link", label: "Lien de paiement" },
];

export function VenteComptoirForm() {
  // Remonter tout le sous-arbre change sa `key` : c'est ce qui permet à
  // « Nouvelle vente » de repartir d'un état totalement vierge (panier,
  // champs, mode espèces par défaut, ET l'état de l'action lui-même) sans
  // rechargement de page — useActionState n'expose aucune API de reset.
  const [generation, setGeneration] = useState(0);

  return (
    <Card className="mb-6">
      <VenteComptoirFormInterne key={generation} onNouvelleVente={() => setGeneration((g) => g + 1)} />
    </Card>
  );
}

function VenteComptoirFormInterne({ onNouvelleVente }: { onNouvelleVente: () => void }) {
  const [state, formAction, pending] = useActionState<CreateInvoiceActionState, FormData>(
    createAndIssueInvoiceAction,
    null,
  );

  const [designation, setDesignation] = useState("");
  const [quantite, setQuantite] = useState("1");
  const [montantGnf, setMontantGnf] = useState("");
  const [panier, setPanier] = useState<LigneVente[]>([]);
  const [settlementMode, setSettlementMode] = useState<SettlementMode>("cash");
  const [telephone, setTelephone] = useState("");

  const succes = state && "invoiceId" in state ? state : null;

  const pretAAjouter = designation.trim() !== "" && Number(montantGnf) > 0 && Number(quantite) > 0;

  function ajouterAuPanier() {
    if (!pretAAjouter) return;
    setPanier((prev) => [
      ...prev,
      { description: designation.trim(), quantity: Number(quantite) || 1, unitPriceGnf: Number(montantGnf) },
    ]);
    // Le geste reste rapide : les champs se vident pour l'article suivant,
    // sans perdre le focus (les mêmes champs contrôlés restent montés).
    setDesignation("");
    setQuantite("1");
    setMontantGnf("");
  }

  function retirerDuPanier(index: number) {
    setPanier((prev) => prev.filter((_, i) => i !== index));
  }

  const totalGnf = useMemo(
    () => panier.reduce((somme, ligne) => somme + ligne.quantity * ligne.unitPriceGnf, 0),
    [panier],
  );

  const linesJson = useMemo(() => JSON.stringify(panier), [panier]);

  if (succes) {
    return <ConfirmationVente succes={succes} onNouvelleVente={onNouvelleVente} />;
  }

  const lienChoisi = settlementMode === "payment_link";

  return (
    <form action={formAction} className="p-5">
      <input type="hidden" name="linesJson" value={linesJson} />
      <input type="hidden" name="documentType" value="invoice" />

      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-navy-950">Vente au comptoir</h2>
        <p className="text-xs text-navy-600">Émise et certifiée immédiatement.</p>
      </div>

      {/* ── Ajout d'un article au panier ──────────────────────────────────── */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_0.7fr_1fr_auto]">
        <Champ
          id="vente-designation"
          label="Article"
          value={designation}
          onChange={setDesignation}
          placeholder="Sac de riz 25 kg"
        />
        <Champ
          id="vente-quantite"
          label="Quantité"
          value={quantite}
          onChange={setQuantite}
          type="number"
          mono
        />
        <Champ
          id="vente-montant"
          label="Montant unitaire (GNF)"
          value={montantGnf}
          onChange={setMontantGnf}
          placeholder="85000"
          type="number"
          mono
        />
        <div className="flex items-end">
          <Button
            type="button"
            variant="secondary"
            onClick={ajouterAuPanier}
            disabled={!pretAAjouter}
            className="w-full sm:w-auto"
          >
            Ajouter au panier
          </Button>
        </div>
      </div>

      {/* ── Panier ─────────────────────────────────────────────────────────── */}
      {panier.length > 0 ? (
        <div className="mt-4 rounded-lg border border-navy-100">
          <ul className="divide-y divide-navy-50">
            {panier.map((ligne, index) => (
              <li key={index} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="truncate text-navy-950">
                  {ligne.description} × {ligne.quantity}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono tabular-nums text-navy-950">
                    {(ligne.quantity * ligne.unitPriceGnf).toLocaleString("fr-FR")} GNF
                  </span>
                  <button
                    type="button"
                    onClick={() => retirerDuPanier(index)}
                    aria-label={`Retirer ${ligne.description} du panier`}
                    className="text-navy-600 transition hover:text-red-text"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-navy-100 px-3 py-2 font-display text-sm font-bold text-navy-950">
            <span>Total</span>
            <span className="font-mono text-base tabular-nums">{totalGnf.toLocaleString("fr-FR")} GNF</span>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-navy-600">Aucun article dans le panier pour l&apos;instant.</p>
      )}

      {/* ── Règlement ──────────────────────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
        <fieldset>
          <legend className="mb-1.5 block font-sans text-[11px] font-semibold tracking-wide text-navy-950 uppercase">
            Règlement
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {MODES_REGLEMENT.map((mode) => (
              <label
                key={mode.valeur}
                className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-navy-200 px-3 text-sm font-medium whitespace-nowrap text-navy-950 has-[:checked]:border-navy-950 has-[:checked]:bg-navy-50"
              >
                <input
                  type="radio"
                  name="settlementMode"
                  value={mode.valeur}
                  checked={settlementMode === mode.valeur}
                  onChange={() => setSettlementMode(mode.valeur)}
                  className="accent-navy-950"
                />
                {mode.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label
            htmlFor="customerPhone"
            className="mb-1.5 block font-sans text-[11px] font-semibold tracking-wide text-navy-950 uppercase"
          >
            Téléphone {lienChoisi ? <span className="text-red-text">*</span> : <span className="text-navy-600">(facultatif)</span>}
          </label>
          <input
            id="customerPhone"
            name="customerPhone"
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            required={lienChoisi}
            value={telephone}
            onChange={(event) => setTelephone(event.target.value)}
            placeholder="622 00 00 00"
            className="min-h-[44px] w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 font-mono text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none"
          />
        </div>
      </div>

      <p className="mt-2 text-xs text-navy-600">
        {lienChoisi
          ? "Le lien sera généré à l'émission et envoyé par SMS à ce numéro. En cas d'échec de génération, vous pourrez réessayer depuis la facture."
          : "Sans numéro, la facture reste anonyme. Avec, le client est retrouvé s'il existe déjà — jamais dupliqué."}
      </p>

      <div className="mt-3">
        <Button type="submit" variant="accent" disabled={panier.length === 0 || pending} className="w-full sm:w-auto">
          {pending ? "Émission…" : lienChoisi ? "Envoyer le lien" : "Encaisser"}
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

// ── Confirmation ─────────────────────────────────────────────────────────────
// Remplace le formulaire (jamais un redirect silencieux) : le marchand doit
// savoir ce qui s'est réellement passé — lien envoyé, lien généré sans envoi,
// ou lien resté indisponible — avant d'enchaîner sur la vente suivante.
function ConfirmationVente({
  succes,
  onNouvelleVente,
}: {
  succes: CreateInvoiceSuccess;
  onNouvelleVente: () => void;
}) {
  // Le lien peut exister même en réglement espèces (organisation avec
  // l'auto-envoi actif, voir actions.ts) : on se fie à `paymentLinkUrl`,
  // jamais à `settlementMode` seul, pour décider de l'afficher.
  const lienGenerationEchouee = !succes.paymentLinkUrl && succes.settlementMode === "payment_link";

  return (
    <div className="p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-navy-950">Vente enregistrée</h2>
        {succes.number ? <span className="font-mono text-xs text-navy-600">{succes.number}</span> : null}
      </div>

      <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-navy-950">{formatGnf(succes.totalTtc)}</p>

      {succes.paymentLinkUrl ? (
        <div className="mt-4 rounded-xl border border-navy-100 bg-white p-4">
          <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">Lien de paiement</p>
          <code className="mt-2 block rounded-lg bg-navy-50 px-3 py-2 font-mono text-xs break-all text-navy-950">
            {succes.paymentLinkUrl}
          </code>
          <p className="mt-2 text-xs text-navy-600">
            {succes.customerPhone
              ? `Envoyé par SMS au ${succes.customerPhone}.`
              : "Aucun numéro fourni — montrez ce lien à votre client."}
          </p>
        </div>
      ) : lienGenerationEchouee ? (
        <p className="mt-4 text-sm text-bad-text">
          Facture émise, mais le lien n&apos;a pas pu être généré tout de suite.{" "}
          <Link
            href={`/dashboard/invoices/${encodeURIComponent(succes.invoiceId)}`}
            className="underline underline-offset-2"
          >
            Réessayez depuis la fiche de la facture
          </Link>
          .
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Link
          href={`/dashboard/invoices/${encodeURIComponent(succes.invoiceId)}`}
          className="text-sm font-medium text-navy-950 underline underline-offset-2"
        >
          Voir la facture complète
        </Link>
        <Button type="button" variant="secondary" onClick={onNouvelleVente}>
          Nouvelle vente
        </Button>
      </div>
    </div>
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
  placeholder?: string;
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
