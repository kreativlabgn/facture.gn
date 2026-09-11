import type { Metadata } from "next";
import Link from "next/link";
import { fetchPublicCheckout } from "@/lib/money-api";
import { formatGnf } from "@/lib/format";
import { pourcentage, tauxEffectifBps } from "@/lib/plans";
import {
  PORTAIL_DEMO,
  checkoutDemo,
  paiementOuvert,
  statutCheckoutDepuisUrl,
  type CheckoutDemo,
  type StatutCheckoutDemo,
} from "@/lib/demo-accounts";
import { Wordmark } from "@/components/Wordmark";

type Params = { invoiceId: string };
type Query = Record<string, string | string[] | undefined>;

export const metadata: Metadata = { title: "Payer — facture.gn" };

// Première page de ce repo destinée à un payeur sans compte facture.gn (C19) —
// affiche le montant ET les frais AVANT de rediriger vers le provider
// (Djomy/Moneroo), pour ne jamais laisser le payeur découvrir un frais une fois
// déjà chez l'opérateur.
export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Query>;
}) {
  const [{ invoiceId }, query] = await Promise.all([params, searchParams]);

  // Le guichet de démonstration est intercepté AVANT l'appel réseau, et sur une
  // égalité stricte d'identifiant (voir lib/demo-accounts.ts) : un préfixe
  // partagé détournerait de vraies factures vers la vitrine. Toute autre
  // adresse part vers money-api comme avant — ce branchement n'ajoute pas un
  // chemin de secours au chemin réel, il ajoute une adresse à part.
  const demonstration = checkoutDemo(invoiceId);
  const checkout = demonstration ? null : await fetchPublicCheckout(invoiceId);

  return (
    <div className="flex min-h-full flex-col bg-grey">
      <header className="border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-[420px] items-center px-4 py-4 sm:px-6">
          <Wordmark href="/" ariaLabel="facture.gn — Accueil" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-[420px] flex-1 px-4 py-12 sm:px-6">
        {demonstration ? (
          <CheckoutDemonstration
            checkout={demonstration}
            statut={statutCheckoutDepuisUrl(query.statut)}
          />
        ) : checkout ? (
          <CheckoutSummary checkout={checkout} />
        ) : (
          <NoActiveLink />
        )}
      </main>
    </div>
  );
}

// ── Guichet de démonstration ────────────────────────────────────────────────
//
// Même gabarit, mêmes libellés et même ligne de frais unique que le guichet
// réel au-dessus : ce qu'on montre ici doit être ce qu'un payeur verra. La
// SEULE chose en plus est le sélecteur d'état, qui n'existe évidemment pas en
// production — il sert à démontrer ce qui se passe quand le paiement se ferme.

const LIBELLES_STATUT: Record<StatutCheckoutDemo, string> = {
  a_payer: "À régler",
  paid: "Déjà réglée",
  litige: "Contestée",
};

function CheckoutDemonstration({
  checkout,
  statut,
}: {
  checkout: CheckoutDemo;
  statut: StatutCheckoutDemo;
}) {
  const ouvert = paiementOuvert(statut);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border-2 border-or bg-white p-4">
        <span className="inline-flex items-center rounded-full bg-or px-2.5 py-1 font-mono text-[11px] font-bold tracking-wide text-navy-950 uppercase">
          Démonstration
        </span>
        <p className="mt-2 text-xs leading-relaxed text-navy-600">
          Facture fictive. Aucun débit n’est possible depuis cet écran.
        </p>
      </div>

      <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-[0_1px_2px_rgba(11,29,58,0.04)]">
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <p className="font-display text-lg font-bold text-navy-950">Paiement</p>
          <p className="font-mono text-xs font-bold text-navy-950">{checkout.numero}</p>
        </div>

        <div className="mb-5 rounded-xl border border-navy-100 bg-grey p-4">
          <p className="text-xs text-navy-600">Émise par</p>
          <p className="mt-0.5 text-sm font-semibold text-navy-950">{checkout.marchand}</p>
          <p className="mt-2 text-xs text-navy-600">À l’attention de</p>
          <p className="mt-0.5 text-sm font-semibold text-navy-950">{checkout.client}</p>
        </div>

        {/* Une seule ligne de frais, taux DÉRIVÉ des montants — identique au
            guichet réel. Deux lignes côte à côte exposeraient au payeur la
            répartition interne d'une somme qu'il débourse de toute façon. */}
        <dl className="space-y-3">
          <Row label="Montant de la marchandise" value={formatGnf(checkout.marchandise)} />
          <Row
            label={`Frais de transaction (${pourcentage(checkout.tauxEffectifBps)})`}
            value={formatGnf(checkout.fraisTransaction)}
          />
          <div className="border-t border-navy-100 pt-3">
            <Row label="Total à payer" value={formatGnf(checkout.totalPayeur)} bold />
          </div>
        </dl>

        {ouvert ? (
          <div className="mt-6 flex flex-col gap-3">
            <BoutonOperateur nom="Orange Money" total={checkout.totalPayeur} />
            <BoutonOperateur nom="MTN MoMo" total={checkout.totalPayeur} />
          </div>
        ) : (
          <PaiementFerme statut={statut} />
        )}
      </div>

      {/* Le sélecteur d'état : trois liens, pas un bouton radio piloté en
          JavaScript. L'état vit dans l'URL — la démonstration se partage, se
          met en favori, et se rejoue à l'identique après un rechargement. */}
      <div className="rounded-2xl border border-navy-100 bg-white p-5">
        <p className="text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
          Simuler l’état de la facture
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(LIBELLES_STATUT) as StatutCheckoutDemo[]).map((valeur) => {
            const actif = valeur === statut;
            return (
              <Link
                key={valeur}
                href={`/pay/${PORTAIL_DEMO.invoiceId}?statut=${valeur}`}
                aria-current={actif ? "page" : undefined}
                className={[
                  "inline-flex min-h-[40px] items-center rounded-[10px] border px-4 text-sm font-semibold transition",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950",
                  actif
                    ? "border-navy-950 bg-navy-950 text-white"
                    : "border-navy-200 bg-white text-navy-950 hover:bg-navy-50",
                ].join(" ")}
              >
                {LIBELLES_STATUT[valeur]}
              </Link>
            );
          })}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-navy-600">
          Le bouton Mobile Money disparaît sur les deux derniers états — un paiement rouvert sur une
          facture déjà réglée serait un second débit, et sur une facture contestée il encaisserait
          la somme même dont on discute.
        </p>
      </div>
    </div>
  );
}

/** Le bouton est rendu à PLEINE opacité, pas grisé : toute la démonstration
 *  consiste à montrer la différence entre un guichet ouvert et un guichet
 *  fermé, et deux boutons ternes ne la montrent pas.
 *
 *  Il ne déclenche rien pour autant — aucun gestionnaire, aucune URL de
 *  paiement, et `aria-disabled` le dit aux technologies d'assistance plutôt que
 *  de les laisser annoncer une action qui n'existe pas. `disabled` tout court
 *  l'aurait en plus sorti de l'ordre de tabulation, donc rendu invisible à qui
 *  parcourt la page au clavier. */
function BoutonOperateur({ nom, total }: { nom: string; total: string }) {
  return (
    <button
      type="button"
      aria-disabled="true"
      className="block w-full cursor-not-allowed rounded-[10px] bg-or px-6 py-3 text-center font-display text-sm font-semibold text-navy-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
    >
      Payer {formatGnf(total)} via {nom}
    </button>
  );
}

/** La fermeture est un ÉTAT EXPLIQUÉ, pas un bouton grisé. Un payeur devant un
 *  bouton inerte cherche ce qu'il a mal fait ; devant une phrase, il sait quoi
 *  faire ensuite — et à qui parler. */
function PaiementFerme({ statut }: { statut: StatutCheckoutDemo }) {
  const conteste = statut === "litige";

  return (
    <div
      className={[
        "mt-6 rounded-xl border p-5 text-center",
        conteste ? "border-red bg-red-bg" : "border-good bg-good-bg",
      ].join(" ")}
    >
      <p className={`font-display text-sm font-bold ${conteste ? "text-red-text" : "text-good-text"}`}>
        {conteste ? "Facture contestée" : "Facture déjà réglée"}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-navy-600">
        {conteste
          ? "Le montant fait l’objet d’une contestation en cours. Le paiement rouvrira dès que le marchand aura émis sa correction."
          : "Le règlement de cette facture a déjà été encaissé. Aucun second paiement n’est possible."}
      </p>
    </div>
  );
}

function CheckoutSummary({ checkout }: { checkout: NonNullable<Awaited<ReturnType<typeof fetchPublicCheckout>>> }) {
  const amount = BigInt(checkout.amountGnf);
  const feeGateway = BigInt(checkout.feeGatewayGnf);
  const feePlatform = BigInt(checkout.feePlatformGnf);
  const total = amount + feeGateway;
  // `amountGnf` porte DÉJÀ la commission facture.gn : la marchandise, c'est ce
  // qui reste quand on la retire. L'ancienne ligne « Montant de la facture »
  // affichait la somme des deux sous le nom de la première — le payeur voyait
  // un prix et en réglait un autre.
  const marchandise = amount - feePlatform;

  // UNE ligne de frais, pas deux. La répartition commission / passerelle est
  // notre plomberie : elle ne change rien à ce que le payeur débourse, et la
  // détailler au guichet donnait à un montant simple un air de négociation.
  //
  // Le taux entre parenthèses est DÉRIVÉ de ces deux montants relus, jamais
  // écrit en dur : sur une facture qui dépasse le plafond de commission du
  // marchand, le taux réel décroche du barème nominal, et c'est le montant qui
  // fait foi.
  const fraisTotal = feeGateway + feePlatform;
  const taux = tauxEffectifBps(marchandise.toString(), fraisTotal.toString());

  const expired = checkout.expiresAt !== null && new Date(checkout.expiresAt) < new Date();

  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-[0_1px_2px_rgba(11,29,58,0.04)]">
      <p className="mb-6 font-display text-lg font-bold text-navy-950">Paiement</p>
      {/* Les montants sont RELUS de la tentative de paiement, jamais recalculés
          depuis le barème : ce qui est affiché est ce qui a été facturé, pas ce
          que la grille prévoit aujourd'hui. Un barème qui changerait entre la
          création du lien et son règlement ne doit pas réécrire après coup ce
          que le payeur voit. */}
      <dl className="space-y-3">
        <Row label="Montant de la marchandise" value={formatGnf(marchandise.toString())} />
        <Row
          label={taux > 0 ? `Frais de transaction (${pourcentage(taux)})` : "Frais de transaction"}
          value={formatGnf(fraisTotal.toString())}
        />
        <div className="border-t border-navy-100 pt-3">
          <Row label="Total à payer" value={formatGnf(total.toString())} bold />
        </div>
      </dl>
      {expired || !checkout.paymentLinkUrl ? (
        <p className="mt-6 text-center text-sm text-navy-600">Ce lien de paiement a expiré.</p>
      ) : (
        <a
          href={checkout.paymentLinkUrl}
          className="mt-6 block rounded-[10px] bg-or px-6 py-3 text-center font-display text-sm font-semibold text-navy-950 transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
        >
          Payer {formatGnf(total.toString())} via {checkout.provider === "djomy" ? "Djomy" : "Moneroo"}
        </a>
      )}
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-navy-600">{label}</dt>
      <dd className={`font-mono text-sm ${bold ? "font-bold text-navy-950" : "text-navy-950"}`}>{value}</dd>
    </div>
  );
}

function NoActiveLink() {
  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-8 text-center">
      <p className="font-display text-lg font-bold text-navy-950">Aucun lien de paiement actif</p>
      <p className="mx-auto mt-3 max-w-sm text-sm text-navy-600">
        Ce lien n&apos;est plus valide. Contactez le marchand pour obtenir un nouveau lien de paiement.
      </p>
    </div>
  );
}
