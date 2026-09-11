"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Badge, Button } from "@/components/ui";
import { formatDate, formatGnf } from "@/lib/format";
import { DISBURSEMENT_METHODS, netVerseALaPme } from "@/lib/financing";
import type { FinancialPartnerOption } from "@/lib/trust-api";
import { chooseFinancingAction, type FinancingActionState } from "./actions";

// ─────────────────────────────────────────────────────────────────────────────
// ARBITRAGE DU RAIL DE FINANCEMENT — ADR-088/089, K4/K5.
//
// Le seul endroit du produit où une PME cède sa créance sur l'État. Composant
// client parce que le choix se fait à l'écran, sans aller-retour : le
// commerçant compare deux options avant d'en engager une, il ne remplit pas un
// formulaire dont il découvrirait l'effet après rechargement.
//
// Aucune règle de décision n'est écrite ici — elles vivent dans lib/financing.ts
// (`etatArbitrage`, `netVerseALaPme`) et, pour de bon, dans is-financeable.ts
// côté trust-api. Ce fichier ne fait que rendre l'état qu'on lui donne.
//
// Les deux rails sont EXCLUSIFS et asymétriques, et c'est la nature d'ADR-088 :
//   Rail A  une cession, irréversible, qui POSTe.
//   Rail B  une absence d'action — pas de route, pas de colonne, pas de DTO.
//           Il est rendu quand même : un commerçant qui ne voit qu'un bouton
//           « céder » ne choisit pas, il obéit.
// ─────────────────────────────────────────────────────────────────────────────

const ICONE_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

// Tracées à la main, en `currentColor`, comme le jeu de la barre d'onglets
// (components/shell/icons.tsx) : cinq glyphes ne justifiaient pas une
// dépendance de plus à télécharger sur une connexion mobile guinéenne, deux de
// plus non plus.
function AvanceIcon() {
  return (
    <svg {...ICONE_PROPS}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </svg>
  );
}

function AttenteIcon() {
  return (
    <svg {...ICONE_PROPS}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

// ── Confirmation permanente de la cession (K5) ──────────────────────────────
// Quand `financed_by_partner_id` est renseigné, le formulaire n'est pas grisé :
// il n'existe pas dans cet arbre. Aucun second financement n'est possible, et
// aucun contrôle inerte ne doit laisser croire le contraire.
//
// Le nom du cessionnaire vient de GET /financing/options ; à défaut (route
// injoignable), on rend la référence brute plutôt qu'un nom d'établissement
// inventé — même arbitrage que la console DAF sur un écran comptable.
function CessionEnregistree({
  cessionnaire,
  partnerId,
  financedAt,
  totalTtc,
}: {
  cessionnaire: { id: string; name: string } | null;
  partnerId: string;
  financedAt: string | null;
  totalTtc: string;
}) {
  return (
    <div className="rounded-2xl border border-blue bg-blue-bg p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-base font-semibold text-navy-950">Créance cédée</p>
        <Badge tone="blue">◆ Financement enregistré</Badge>
      </div>

      <p className="mt-2 text-sm text-navy-700">
        Cette facture a été rachetée par un établissement financier agréé BCRG. Le règlement du
        Trésor lui reviendra directement : vous n&apos;avez plus rien à attendre ni à relancer.
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
            Établissement cessionnaire
          </dt>
          {cessionnaire ? (
            <dd className="mt-1 font-display text-base font-bold text-navy-950">{cessionnaire.name}</dd>
          ) : (
            <dd className="mt-1 font-mono text-[13px] font-bold break-all text-navy-950">{partnerId}</dd>
          )}
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-wide text-navy-600 uppercase">Net perçu</dt>
          <dd className="mt-1 font-mono text-base font-bold tabular-nums text-navy-950">
            {formatGnf(totalTtc)}
          </dd>
        </div>
      </dl>

      {financedAt ? (
        <p className="mt-3 text-xs text-navy-600">
          Cession enregistrée le{" "}
          <span className="font-mono font-bold text-navy-950">{formatDate(financedAt)}</span> — cet
          événement est inscrit au journal et ne peut être ni modifié ni supprimé.
        </p>
      ) : null}
    </div>
  );
}

type RailChoisi = "A" | "B" | null;

export function ArbitrageMarchandForm({
  invoiceId,
  totalTtc,
  etat,
  partenaires,
  cessionnaire,
  financedByPartnerId,
  financedAt,
}: {
  invoiceId: string;
  totalTtc: string;
  // Le type interdit « masque » : cette décision appartient à la page, qui ne
  // rend alors rien du tout. Un composant capable de se rendre invisible
  // lui-même finit toujours par être rendu « au cas où ».
  etat: "cedee" | "ouvert";
  partenaires: readonly FinancialPartnerOption[];
  cessionnaire: { id: string; name: string } | null;
  financedByPartnerId: string | null;
  financedAt: string | null;
}) {
  const [state, formAction, pending] = useActionState<FinancingActionState, FormData>(
    chooseFinancingAction,
    null,
  );
  const [rail, setRail] = useState<RailChoisi>(null);

  if (etat === "cedee" && financedByPartnerId) {
    return (
      <CessionEnregistree
        cessionnaire={cessionnaire}
        partnerId={financedByPartnerId}
        financedAt={financedAt}
        totalTtc={totalTtc}
      />
    );
  }

  // K5 — deux chemins mènent à la confirmation : l'état chargé par le serveur
  // ci-dessus, et le 409 rendu à la requête PERDANTE de deux clics simultanés.
  // Le second n'a pas de nom de cessionnaire à afficher (la page n'est pas
  // revalidée sur un échec) : il dit ce qui s'est passé sans prétendre nommer
  // qui a gagné. Dans les deux cas le formulaire disparaît — jamais grisé.
  if (state !== null && "error" in state && state.conflit) {
    return (
      <div className="rounded-2xl border border-blue bg-blue-bg p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-display text-base font-semibold text-navy-950">Arbitrage déjà tranché</p>
          <Badge tone="blue">◆ Financement enregistré</Badge>
        </div>
        <p className="mt-2 text-sm text-navy-700">{state.error}</p>
        <p className="mt-2 text-sm text-navy-700">
          Une seule cession est possible par facture. Rechargez l&apos;écran pour voir
          l&apos;établissement qui a racheté la créance.
        </p>
      </div>
    );
  }

  // Après une cession réussie, la page est revalidée et repassera en « cedee ».
  // D'ici là, les contrôles restent verrouillés : rien ne doit inviter à
  // renvoyer une requête qui ne peut plus rapporter qu'un 409.
  const aboutie = state !== null && "ok" in state;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <RailCarte
          titre="Rail A — Avance immédiate"
          soustitre="Versée par un partenaire agréé BCRG"
          icone={<AvanceIcon />}
          choisi={rail === "A"}
          onChoisir={() => setRail("A")}
          disabled={pending || aboutie}
        >
          Un établissement financier (Ecobank, UBA, COFINA, Akiba Finance) rachète votre créance et
          vous verse l&apos;avance sans attendre le Trésor.
        </RailCarte>

        <RailCarte
          titre="Rail B — Attente du Trésor"
          soustitre="Règlement direct à l'échéance, 0 % de commission"
          icone={<AttenteIcon />}
          choisi={rail === "B"}
          onChoisir={() => setRail("B")}
          disabled={pending || aboutie}
        >
          Vous conservez la créance et attendez le paiement du Trésor public à l&apos;échéance
          nominale du marché.
        </RailCarte>
      </div>

      {rail === "A" ? (
        <RailAFormulaire
          invoiceId={invoiceId}
          totalTtc={totalTtc}
          partenaires={partenaires}
          formAction={formAction}
          pending={pending}
          state={state}
        />
      ) : null}

      {rail === "B" ? <RailBExplication /> : null}
    </div>
  );
}

// Carte de choix. Un <button> et non une <div> cliquable : le clavier, le
// lecteur d'écran et le focus visible viennent avec, sans rien à réécrire.
// `aria-pressed` plutôt qu'un jeu de radios — les deux rails n'ouvrent pas le
// même genre de suite (l'un un formulaire, l'autre une explication), et un
// groupe de radios promettrait une soumission commune qui n'existe pas.
function RailCarte({
  titre,
  soustitre,
  icone,
  choisi,
  onChoisir,
  disabled,
  children,
}: {
  titre: string;
  soustitre: string;
  icone: ReactNode;
  choisi: boolean;
  onChoisir: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={choisi}
      onClick={onChoisir}
      disabled={disabled}
      className={`rounded-2xl border p-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950 disabled:cursor-not-allowed disabled:opacity-45 ${
        choisi ? "border-navy-950 bg-navy-50" : "border-navy-100 bg-white hover:bg-navy-50"
      }`}
    >
      <span className="flex items-center gap-2 text-navy-950">
        {icone}
        <span className="font-display text-sm font-bold">{titre}</span>
      </span>
      <span className="mt-1 block text-xs font-semibold text-navy-600">{soustitre}</span>
      <span className="mt-2 block text-xs text-navy-700">{children}</span>
    </button>
  );
}

// ── Rail A : la cession ─────────────────────────────────────────────────────
function RailAFormulaire({
  invoiceId,
  totalTtc,
  partenaires,
  formAction,
  pending,
  state,
}: {
  invoiceId: string;
  totalTtc: string;
  partenaires: readonly FinancialPartnerOption[];
  formAction: (formData: FormData) => void;
  pending: boolean;
  state: FinancingActionState;
}) {
  const [confirme, setConfirme] = useState(false);
  const aboutie = state !== null && "ok" in state;

  // `financeable` peut être vrai sans qu'aucun partenaire ne soit actif : la
  // liste vient d'une table plateforme, indépendante de la facture. Un <select>
  // vide au-dessus d'un bouton actif ne mènerait qu'à un 409 « partenaire
  // introuvable ou inactif ».
  if (partenaires.length === 0) {
    return (
      <div className="rounded-2xl border border-amber bg-amber-bg p-5">
        <p className="font-display text-sm font-bold text-navy-950">
          Aucun établissement financier disponible
        </p>
        <p className="mt-1 text-sm text-navy-700">
          Aucun partenaire agréé n&apos;est actif sur la plateforme pour l&apos;instant. Le Rail B
          reste ouvert : vous serez réglé par le Trésor à l&apos;échéance.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="rounded-2xl border border-navy-100 bg-white p-5">
      <input type="hidden" name="invoiceId" value={invoiceId} />

      {/* CE QUE LA PME REÇOIT — l'information qui décide, au premier plan.
          ADR-089 : les frais de décaissement sont portés par l'établissement
          financier, jamais déduits du montant certifié. Le net est donc le
          total TTC à l'unité près, lu par netVerseALaPme() — pas un calcul
          refait ici, pour que la règle n'ait qu'un seul endroit.

          Aucun MONTANT de frais n'est affiché, et c'est délibéré : le taux
          (`payout_fee_djomy_bps`, ADR-089) n'existe nulle part dans ce dépôt.
          On dit QUI paie, jamais COMBIEN — inventer un chiffre sur un écran
          comptable serait pire que de ne rien afficher. */}
      <div className="rounded-xl border border-navy-100 bg-white p-4">
        <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
          Net versé à votre entreprise
        </p>
        <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-navy-950">
          {formatGnf(netVerseALaPme({ totalTtc }))}
        </p>
        <p className="mt-2 text-xs text-navy-600">
          100 % du total certifié de la facture. Les frais de décaissement sont à la charge de
          l&apos;établissement financier — jamais déduits de ce que vous percevez.
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-navy-950">Établissement financier</span>
          <select
            name="financialPartnerId"
            required
            disabled={pending || aboutie}
            defaultValue=""
            className="min-h-[44px] rounded-[10px] border border-navy-200 bg-white px-3 text-sm text-navy-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <option value="" disabled>
              Choisir un établissement…
            </option>
            {partenaires.map((partenaire) => (
              <option key={partenaire.id} value={partenaire.id}>
                {partenaire.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-navy-600">Agréé par la BCRG.</span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-navy-950">Mode de versement</span>
          <select
            name="disbursementMethod"
            required
            disabled={pending || aboutie}
            defaultValue={DISBURSEMENT_METHODS[0].value}
            className="min-h-[44px] rounded-[10px] border border-navy-200 bg-white px-3 text-sm text-navy-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {DISBURSEMENT_METHODS.map((methode) => (
              <option key={methode.value} value={methode.value}>
                {methode.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-navy-600">{DISBURSEMENT_METHODS[0].aide}</span>
        </label>
      </div>

      {/* Irréversible, comme l'émission et l'annulation — et davantage : aucune
          route ne défait une cession, ni ici ni côté trust-api. Même geste de
          confirmation explicite que IssueInvoiceForm et VoidInvoiceForm. */}
      <label className="mt-4 flex items-start gap-2.5 text-sm text-navy-700">
        <input
          type="checkbox"
          checked={confirme}
          onChange={(event) => setConfirme(event.target.checked)}
          disabled={pending || aboutie}
          className="mt-0.5 h-4 w-4 shrink-0 accent-navy-950"
        />
        <span>
          Je confirme la cession de cette créance. Le règlement du Trésor ira à
          l&apos;établissement choisi, et cette facture ne pourra plus être financée une seconde
          fois.
        </span>
      </label>

      <div className="mt-4">
        <Button type="submit" variant="accent" disabled={!confirme || pending || aboutie}>
          {pending ? "Cession en cours…" : "Céder la créance et recevoir l'avance"}
        </Button>
      </div>

      <Retour state={state} />
    </form>
  );
}

// ── Rail B : l'absence d'action ─────────────────────────────────────────────
// Aucun bouton de soumission : ADR-088 définit le Rail B comme l'état par
// défaut de toute facture. Rendre ici un formulaire qui ne poste rien — ou
// pire, qui posterait pour « enregistrer » un non-choix — inventerait un état
// que la base ne porte pas.
function RailBExplication() {
  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-5">
      <p className="font-display text-sm font-bold text-navy-950">
        Rien à faire : c&apos;est déjà l&apos;option en cours
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">Commission</p>
          <p className="mt-1 font-mono text-base font-bold tabular-nums text-navy-950">0 %</p>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">Règlement</p>
          <p className="mt-1 text-sm text-navy-950">Par le Trésor public, à l&apos;échéance</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-navy-600">
        Tant que vous ne cédez pas la créance, elle reste la vôtre. Vous pourrez revenir au Rail A
        plus tard, aussi longtemps que la facture n&apos;est ni payée ni annulée.
      </p>
    </div>
  );
}

// Retour d'action, à l'endroit où l'on a cliqué. Le message de refus de
// trust-api est relayé tel quel — il distingue « non finançable », « partenaire
// introuvable ou inactif » et « déjà financée », trois refus qui n'appellent pas
// la même suite. Le cas 409 ne passe jamais par ici : il remplace le formulaire.
function Retour({ state }: { state: FinancingActionState }) {
  if (!state) {
    return null;
  }
  const erreur = "error" in state;
  return (
    <p role="status" className={`mt-3 text-sm ${erreur ? "text-bad-text" : "text-good-text"}`}>
      {erreur ? state.error : state.ok}
    </p>
  );
}
