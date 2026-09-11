import type { Metadata } from "next";
import Link from "next/link";
import { fetchPublicCheckout, type PublicCheckout } from "@/lib/money-api";
import { formatGnf } from "@/lib/format";
import { eclaterFrais } from "@/lib/checkout-fees";
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
import { MobileMoneyForm } from "./MobileMoneyForm";

type Params = { invoiceId: string };
type Query = Record<string, string | string[] | undefined>;

export const metadata: Metadata = { title: "Payer — facture.gn" };

// Première page de ce repo destinée à un payeur sans compte facture.gn (C19) —
// affiche le montant ET les frais AVANT de rediriger vers le provider
// (Djomy/Moneroo), pour ne jamais laisser le payeur découvrir un frais une fois
// déjà chez l'opérateur.
//
// Chantier 3 — la page ne se contente plus de rediriger : elle encaisse. Le
// formulaire Mobile Money pousse le débit sur le téléphone du payeur, le lien
// vers le provider restant le chemin de repli. Deux choses en découlent :
//   • le récapitulatif doit être exact AVANT le clic, puisqu'il n'y a plus
//     d'écran du provider derrière pour rattraper ce qu'il aurait tu ;
//   • l'état de la facture décide de l'ouverture du paiement (`payable`), et
//     c'est money-api qui tranche — cet écran ne rejuge rien.
//
// À ne pas confondre avec /portail/[invoiceId], qui sert l'acheteur AVEC un
// compte, authentifié par OTP SMS, et lui montre toutes ses factures. Les deux
// coexistent et ne partagent ni session ni cookie.
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
          <CheckoutSummary checkout={checkout} invoiceId={invoiceId} />
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
// réel plus bas : ce qu'on montre ici doit être ce qu'un payeur verra. La
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
      <p
        className={`font-display text-sm font-bold ${conteste ? "text-red-text" : "text-good-text"}`}
      >
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

function CheckoutSummary({ checkout, invoiceId }: { checkout: PublicCheckout; invoiceId: string }) {
  // L'éclatement vit dans lib/checkout-fees.ts : c'est une RÈGLE (le marchand
  // n'est jamais amputé, le total est la somme de la marchandise et des frais),
  // pas une décision d'affichage, et une règle doit pouvoir être éprouvée sans
  // monter un rendu React — même partage que lib/daf.ts et l'écran DAF.
  const frais = eclaterFrais(checkout);

  // UNE ligne de frais à l'écran, pas deux : la règle en calcule trois, le
  // guichet en montre une. La répartition commission / passerelle est notre
  // plomberie — elle ne change rien à ce que le payeur débourse, et la
  // détailler au guichet donnait à un montant simple un air de négociation.
  // C'est aussi ce que montre le guichet de démonstration ci-dessus, qui doit
  // rester le miroir exact de cet écran.
  //
  // Le taux entre parenthèses est DÉRIVÉ des montants relus, jamais écrit en
  // dur : sur une facture qui dépasse le plafond de commission du marchand, le
  // taux réel décroche du barème nominal, et c'est le montant qui fait foi.
  const fraisTotal = frais.fraisPlateformeGnf + frais.fraisGatewayGnf;
  const taux = tauxEffectifBps(frais.marchandiseGnf.toString(), fraisTotal.toString());

  const expired = checkout.expiresAt !== null && new Date(checkout.expiresAt) < new Date();
  const totalAffiche = formatGnf(frais.totalGnf.toString());
  const nomProvider = nommerProvider(checkout.provider);

  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-[0_1px_2px_rgba(11,29,58,0.04)]">
      <p className="mb-6 font-display text-lg font-bold text-navy-950">Paiement</p>
      {/* Les montants sont RELUS de la tentative de paiement, jamais recalculés
          depuis le barème : ce qui est affiché est ce qui a été facturé, pas ce
          que la grille prévoit aujourd'hui. Un barème qui changerait entre la
          création du lien et son règlement ne doit pas réécrire après coup ce
          que le payeur voit. */}
      <dl className="space-y-3">
        <Row label="Montant de la marchandise" value={formatGnf(frais.marchandiseGnf.toString())} />
        <Row
          label={taux > 0 ? `Frais de transaction (${pourcentage(taux)})` : "Frais de transaction"}
          value={formatGnf(fraisTotal.toString())}
        />
        <div className="border-t border-navy-100 pt-3">
          {/* Le total en grand : c'est le seul nombre que le payeur doit
              retenir, et c'est celui qui sera repris sur le bouton. */}
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-sm font-semibold text-navy-950">Total à payer</dt>
            <dd className="font-mono text-2xl font-bold tabular-nums text-navy-950">
              {totalAffiche}
            </dd>
          </div>
        </div>
      </dl>

      <Reglement
        checkout={checkout}
        invoiceId={invoiceId}
        totalAffiche={totalAffiche}
        nomProvider={nomProvider}
        expired={expired}
      />
    </div>
  );
}

// Trois issues, dans cet ordre de priorité : la facture n'accepte plus de
// paiement, le lien a expiré, ou l'on peut payer. L'état de la facture passe
// AVANT l'expiration — dire « ce lien a expiré » d'une facture déjà réglée
// enverrait le payeur en redemander un au marchand pour rien.
function Reglement({
  checkout,
  invoiceId,
  totalAffiche,
  nomProvider,
  expired,
}: {
  checkout: PublicCheckout;
  invoiceId: string;
  totalAffiche: string;
  nomProvider: string;
  expired: boolean;
}) {
  if (!checkout.payable) {
    return (
      <p
        role="status"
        className="mt-6 rounded-lg border border-navy-200 bg-navy-50 px-4 py-3 text-center text-sm text-navy-950"
      >
        {checkout.messageRefus ?? "Cette facture ne peut pas être réglée en ligne."}
      </p>
    );
  }

  if (expired || !checkout.paymentLinkUrl) {
    return <p className="mt-6 text-center text-sm text-navy-600">Ce lien de paiement a expiré.</p>;
  }

  return (
    <>
      <MobileMoneyForm invoiceId={invoiceId} totalAffiche={totalAffiche} provider={nomProvider} />

      {/* Chemin de repli, conservé : tous les providers ne savent pas pousser un
          débit (Moneroo n'a pas de barème de frais modélisé, il ne le fait donc
          pas), et un payeur qui ne reçoit pas la sollicitation sur son téléphone
          doit garder un moyen de régler. */}
      <div className="mt-6 border-t border-navy-100 pt-4 text-center">
        <a
          href={checkout.paymentLinkUrl}
          className="text-sm font-medium text-navy-950 underline underline-offset-2"
        >
          Payer autrement sur {nomProvider}
        </a>
      </div>
    </>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-navy-600">{label}</dt>
      {/* font-mono + tabular-nums sur TOUS les montants : les chiffres doivent
          s'aligner d'une ligne à l'autre, sinon l'œil ne peut pas vérifier que
          le total est bien la somme de ce qui est au-dessus. */}
      <dd
        className={`font-mono text-sm tabular-nums ${bold ? "font-bold text-navy-950" : "text-navy-950"}`}
      >
        {value}
      </dd>
    </div>
  );
}

// Les deux seuls providers branchés (ADR-073 en vise quatre). Le nom brut de
// l'enum n'a jamais été montré à un payeur.
function nommerProvider(provider: string): string {
  return provider === "moneroo" ? "Moneroo" : "Djomy";
}

function NoActiveLink() {
  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-8 text-center">
      <p className="font-display text-lg font-bold text-navy-950">Aucun lien de paiement actif</p>
      <p className="mx-auto mt-3 max-w-sm text-sm text-navy-600">
        Ce lien n&apos;est plus valide. Contactez le marchand pour obtenir un nouveau lien de
        paiement.
      </p>
    </div>
  );
}
