import type { Metadata } from "next";
import Link from "next/link";
import {
  FACTURES_MARCHAND_DEMO,
  MARCHAND_DEMO,
  PLAFOND_DEMO_CENTIMES,
  PORTAIL_DEMO,
  portefeuilleDemo,
  resteDu,
  type FactureDemo,
} from "@/lib/demo-accounts";
import { formatDate, formatGnf } from "@/lib/format";
import { pourcentage } from "@/lib/plans";
import { AnneauRepartition, BarresVolume, CourbeEncaissements } from "@/components/Illustrations";
import { BandeauDemo } from "@/components/ComptesDemo";
import { Wordmark } from "@/components/Wordmark";

export const metadata: Metadata = {
  title: "Démonstration — Tableau de bord marchand — facture.gn",
  // Une vitrine n'a rien à faire dans un index de recherche : elle porterait
  // des chiffres inventés sous le nom du produit, et un extrait Google
  // annoncerait « 45 000 000 GNF » comme s'il s'agissait d'un résultat réel.
  robots: { index: false, follow: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// TABLEAU DE BORD MARCHAND — DÉMONSTRATION.
//
// Écran autonome : il ne lit aucune session, n'appelle aucune API, et vit hors
// du groupe `(app)` exprès. Le vrai /dashboard exige un token et une
// organisation active ; le brancher sur un mode « démo » aurait mis une
// bifurcation de données factices au milieu du chemin de production — le genre
// de raccourci qui finit par afficher un chiffre inventé à un vrai marchand.
//
// Ce que la page doit prouver, dans l'ordre où on le regarde : que les quatre
// statuts coexistent, qu'un litige porte une conversation et pas un drapeau,
// et que le taux annoncé est celui qu'on prélève.
// ─────────────────────────────────────────────────────────────────────────────

const MOIS = ["Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Sept."];

export default function DemoMarchandPage() {
  const portefeuille = portefeuilleDemo();
  const enLitige = FACTURES_MARCHAND_DEMO.filter((facture) => facture.litige);

  return (
    <div className="flex min-h-full flex-col bg-grey">
      <header className="border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Wordmark href="/" ariaLabel="facture.gn — Accueil" />
          <Link
            href="/inscription"
            className="text-sm font-semibold text-navy-950 underline underline-offset-2"
          >
            Quitter la démonstration
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6">
          <BandeauDemo>
Écran de démonstration de <strong>{MARCHAND_DEMO.organisation}</strong> — données
            fictives, aucun appel réseau, aucune session ouverte. Les montants de frais sont
            calculés par le même code que le guichet de paiement.
          </BandeauDemo>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-navy-950">
                {MARCHAND_DEMO.organisation}
              </h1>
              <p className="mt-1 text-sm text-navy-600">{MARCHAND_DEMO.activite}</p>
            </div>
            <span className="inline-flex items-center rounded-full border border-navy-200 bg-white px-3 py-1 font-mono text-[11px] font-bold tracking-wide text-navy-950 uppercase">
              Palier gratuit
            </span>
          </div>

          {/* ── Compteurs ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Compteur
              libelle="Volume émis"
              valeur={formatGnf(portefeuille.volumeCentimes)}
              portee={`${portefeuille.facturesTotal} factures`}
            />
            <Compteur
              libelle="Encaissées"
              valeur={String(portefeuille.encaissees)}
              portee={`sur ${portefeuille.facturesTotal} émises`}
            />
            <Compteur
              libelle="En litige"
              valeur={String(portefeuille.litiges)}
              portee="issue proposée, à valider"
              alerte
            />
            <Compteur
              libelle="Taux effectif"
              valeur={pourcentage(portefeuille.tauxEffectifBps)}
              portee={`barème ${pourcentage(portefeuille.tauxBaremeBps)}`}
            />
          </div>

          {/* ── Graphiques ───────────────────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-2xl border border-navy-100 bg-white p-6 lg:col-span-2">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-display text-base font-semibold text-navy-950">
                  Encaissements des 7 derniers mois
                </h2>
                <p className="font-mono text-sm font-bold text-navy-950">
                  {formatGnf(portefeuille.volumeCentimes)}
                </p>
              </div>
              <CourbeEncaissements
                points={[21, 28, 26, 39, 44, 58, 71]}
                className="h-36 w-full sm:h-44"
              />
              <div className="mt-2 flex justify-between">
                {MOIS.map((mois) => (
                  <span key={mois} className="text-[11px] text-navy-600">
                    {mois}
                  </span>
                ))}
              </div>
              <div className="mt-6">
                <h3 className="mb-3 text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
                  Volume facturé par mois
                </h3>
                <BarresVolume valeurs={[31, 42, 38, 55, 61, 74, 89]} accentuer={6} />
              </div>
            </section>

            <section className="flex flex-col items-center rounded-2xl border border-navy-100 bg-white p-6">
              <h2 className="mb-1 self-start font-display text-base font-semibold text-navy-950">
                Où en sont vos factures
              </h2>
              <p className="mb-4 self-start text-xs leading-relaxed text-navy-600">
                Les états se cumulent : une facture encaissée peut rester contestée.
              </p>
              <AnneauRepartition
                total={String(portefeuille.facturesTotal)}
                legende="FACTURES"
                parts={[
                  { libelle: "Encaissées", valeur: portefeuille.encaissees, trait: "stroke-green" },
                  {
                    libelle: "En attente",
                    valeur:
                      portefeuille.facturesTotal - portefeuille.encaissees - portefeuille.litiges,
                    trait: "stroke-or",
                  },
                  { libelle: "En litige", valeur: portefeuille.litiges, trait: "stroke-red" },
                ]}
                className="h-44 w-44"
              />
              <dl className="mt-5 w-full flex-col gap-2.5">
                <Legende
                  pastille="bg-green"
                  libelle="Encaissées"
                  valeur={String(portefeuille.encaissees)}
                />
                <Legende
                  pastille="bg-or"
                  libelle="En attente de paiement"
                  valeur={String(
                    portefeuille.facturesTotal - portefeuille.encaissees - portefeuille.litiges,
                  )}
                />
                <Legende
                  pastille="bg-red"
                  libelle="En litige"
                  valeur={String(portefeuille.litiges)}
                />
                <Legende
                  pastille="bg-navy-200"
                  libelle="Approuvées par le client"
                  valeur={String(portefeuille.approuvees)}
                />
              </dl>
            </section>
          </div>

          {/* ── Ce que les frais ont réellement coûté ────────────────────── */}
          <section className="rounded-2xl border border-navy-100 bg-white p-6 lg:p-8">
            <h2 className="font-display text-lg font-semibold text-navy-950">
              Ce que ces {portefeuille.facturesTotal} factures vous ont coûté
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-navy-600">
              Le barème du palier gratuit est de {pourcentage(portefeuille.tauxBaremeBps)}, mais la
              commission est plafonnée à {formatGnf(PLAFOND_DEMO_CENTIMES)} par encaissement. Sur ce
              portefeuille, huit factures dépassent ce plafond — le taux réellement supporté descend
              donc à {pourcentage(portefeuille.tauxEffectifBps)}.
            </p>
            <dl className="mt-5 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-navy-100 bg-grey p-5">
                <dt className="text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
                  Frais supportés
                </dt>
                <dd className="mt-2 font-mono text-lg font-bold text-navy-950">
                  {formatGnf(portefeuille.fraisCentimes)}
                </dd>
              </div>
              <div className="rounded-xl border border-navy-100 bg-grey p-5">
                <dt className="text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
                  Au barème plein
                </dt>
                <dd className="mt-2 font-mono text-lg font-bold text-navy-950">
                  {formatGnf(
                    (
                      BigInt(portefeuille.fraisCentimes) +
                      BigInt(portefeuille.economiePlafondCentimes)
                    ).toString(),
                  )}
                </dd>
              </div>
              {/* Le seul chiffre de l'écran posé sur l'Or : c'est l'argument, et
                  un seul accent par écran garde sa valeur de signal. Texte
                  Navy sur Or (9.4:1) — jamais de blanc, R-11. */}
              <div className="rounded-xl border border-or bg-or p-5">
                <dt className="font-mono text-xs font-bold tracking-wide text-navy-950 uppercase">
                  Épargné par le plafond
                </dt>
                <dd className="mt-2 font-mono text-lg font-bold text-navy-950">
                  {formatGnf(portefeuille.economiePlafondCentimes)}
                </dd>
              </div>
            </dl>
          </section>

          {/* ── Les litiges, avec leur conversation ──────────────────────── */}
          <section className="rounded-2xl border border-red bg-white p-6 lg:p-8">
            <h2 className="font-display text-lg font-semibold text-navy-950">
              {enLitige.length} contestations ouvertes
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-navy-600">
              Tant que l’exercice n’est pas clos, une contestation reste réparable. C’est le seul
              statut qui attend une action de votre part — et le seul qui laisse encore corriger.
              Chaque fil porte l’issue proposée : un avoir quand le client a raison, le maintien de
              la facture quand la preuve est de votre côté.
            </p>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {enLitige.map((facture) => (
                <FilLitige key={facture.numero} facture={facture} />
              ))}
            </div>
          </section>

          {/* ── La liste ─────────────────────────────────────────────────── */}
          <section className="rounded-2xl border border-navy-100 bg-white p-6 lg:p-8">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold text-navy-950">
                Toutes les factures
              </h2>
              <Link
                href={`/pay/${PORTAIL_DEMO.invoiceId}`}
                className="text-sm font-semibold text-navy-950 underline underline-offset-2"
              >
                Voir un lien de paiement client
              </Link>
            </div>

            {/* Un tableau est la seule chose de cet écran autorisée à déborder :
                il défile seul plutôt que de faire scrouler la page entière ou
                d'écraser huit colonnes sur 360 px. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-navy-100">
                    <Th>Facture</Th>
                    <Th>Client</Th>
                    <Th>Émise le</Th>
                    <Th align="right">Montant</Th>
                    <Th align="right">Frais</Th>
                    <Th>État</Th>
                  </tr>
                </thead>
                <tbody>
                  {FACTURES_MARCHAND_DEMO.map((facture) => (
                    <LigneFacture key={facture.numero} facture={facture} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function Compteur({
  libelle,
  valeur,
  portee,
  alerte = false,
}: {
  libelle: string;
  valeur: string;
  portee: string;
  alerte?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-2xl border bg-white p-5",
        alerte ? "border-red" : "border-navy-100",
      ].join(" ")}
    >
      <p className="text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">{libelle}</p>
      <p className="mt-2 font-mono text-xl font-bold text-navy-950">{valeur}</p>
      {/* La PORTÉE sous chaque compteur, jamais un total nu : « 2 » ne dit rien,
          « 2 à arbitrer avant clôture » dit quoi en faire. */}
      <p className="mt-1 text-xs text-navy-600">{portee}</p>
    </div>
  );
}

function Legende({
  pastille,
  libelle,
  valeur,
}: {
  pastille: string;
  libelle: string;
  valeur: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <dt className="flex items-center gap-2 text-xs text-navy-600">
        <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${pastille}`} />
        {libelle}
      </dt>
      <dd className="font-mono text-xs font-bold text-navy-950">{valeur}</dd>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={[
        "pb-3 text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase",
        align === "right" ? "text-right" : "text-left",
      ].join(" ")}
    >
      {children}
    </th>
  );
}

/** Une pastille par état ACTIF. Aucune ne s'exclut : c'est le point de tout
 *  l'écran — un badge unique « le plus avancé » masquerait le litige d'une
 *  facture par ailleurs encaissée, c'est-à-dire exactement celle qui appelle
 *  une décision. */
function LigneFacture({ facture }: { facture: FactureDemo }) {
  const frais = fraisDeLaFacture(facture);

  return (
    <tr className="border-b border-navy-100 last:border-0">
      <td className="py-3 pr-4 font-mono text-xs font-bold text-navy-950">{facture.numero}</td>
      <td className="py-3 pr-4 text-sm text-navy-600">{facture.client}</td>
      <td className="py-3 pr-4 text-sm text-navy-600">{formatDate(facture.emiseLe)}</td>
      <td className="py-3 pr-4 text-right font-mono text-sm font-bold text-navy-950">
        {formatGnf(facture.montantCentimes)}
      </td>
      <td className="py-3 pr-4 text-right font-mono text-xs text-navy-600">{formatGnf(frais)}</td>
      <td className="py-3">
        <div className="flex flex-wrap gap-1.5">
          {facture.deposee ? <Pastille ton="blue">Déposée</Pastille> : null}
          {facture.approuvee ? <Pastille ton="green">Approuvée</Pastille> : null}
          {facture.encaissee ? <Pastille ton="good">Encaissée</Pastille> : null}
          {facture.litige ? <Pastille ton="red">En litige</Pastille> : null}
        </div>
      </td>
    </tr>
  );
}

const TONS_PASTILLE = {
  blue: "bg-blue-bg text-blue-text",
  green: "bg-green-bg text-green-text",
  good: "bg-good-bg text-good-text",
  red: "bg-red-bg text-red-text",
} as const;

function Pastille({
  ton,
  children,
}: {
  ton: keyof typeof TONS_PASTILLE;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[11px] font-bold ${TONS_PASTILLE[ton]}`}
    >
      {children}
    </span>
  );
}

function FilLitige({ facture }: { facture: FactureDemo }) {
  return (
    <article className="rounded-xl border border-navy-100 bg-grey p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-xs font-bold text-navy-950">{facture.numero}</p>
        <p className="font-mono text-sm font-bold text-navy-950">
          {formatGnf(facture.montantCentimes)}
        </p>
      </div>
      <p className="mt-1 text-sm font-semibold text-navy-950">{facture.client}</p>

      <ol className="mt-4 flex flex-col gap-3">
        {facture.fil.map((message, index) => (
          <li
            key={index}
            className={[
              "rounded-lg border p-3",
              // Le message du client est posé sur blanc, la réponse du marchand
              // sur un liseré Or : on doit voir QUI parle sans lire l'étiquette.
              message.auteur === "client"
                ? "border-navy-100 bg-white"
                : "border-or bg-white",
            ].join(" ")}
          >
            <p className="font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
              {message.auteur === "client" ? "Le client" : "Vous"} · {formatDate(message.quand)}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-navy-600">{message.texte}</p>
          </li>
        ))}
      </ol>

      <VoletResolution facture={facture} />
    </article>
  );
}

/** L'issue proposée, sous la conversation.
 *
 *  C'est la moitié manquante d'un écran de litige : un fil de discussion seul
 *  montre un désaccord et laisse le lecteur sans sortie. Les DEUX voies sont
 *  représentées dans le carnet à dessein — l'avoir quand le client a raison, le
 *  maintien quand la preuve est du côté du marchand. Un tableau de bord qui ne
 *  proposerait que l'avoir apprendrait à ses utilisateurs qu'une contestation
 *  se solde toujours par une remise.
 *
 *  Le reste dû est CALCULÉ (resteDu), et l'avoir n'entame pas le montant de la
 *  facture : la pièce certifiée ne se réécrit pas, l'avoir est une pièce de
 *  plus qui la pointe.
 *
 *  L'issue est PROPOSÉE, pas passée : tant que le client ne l'a pas acceptée,
 *  aucun avoir n'existe — et c'est pourquoi le FEC servi par /demo/cabinet/fec
 *  ne porte que les 14 factures. Un volet qui dirait « avoir émis » ferait
 *  mentir le fichier comptable téléchargeable deux écrans plus loin. */
function VoletResolution({ facture }: { facture: FactureDemo }) {
  const resolution = facture.resolution;
  if (!resolution) {
    return null;
  }

  return (
    <div className="mt-4 rounded-lg border border-navy-200 bg-white p-4">
      <p className="font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
        {resolution.voie === "avoir" ? "Résolution amiable · avoir" : "Contestation levée"}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-navy-600">{resolution.motif}</p>

      {resolution.voie === "avoir" ? (
        <dl className="mt-3 flex flex-col gap-2 border-t border-navy-100 pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-navy-600">Avoir à émettre</dt>
            <dd className="font-mono text-sm font-bold text-navy-950">
              − {formatGnf(resolution.avoirCentimes)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-navy-600">Reste dû après avoir</dt>
            <dd className="font-mono text-sm font-bold text-navy-950">
              {formatGnf(resteDu(facture))}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 border-t border-navy-100 pt-3 font-mono text-sm font-bold text-navy-950">
          {formatGnf(resteDu(facture))} <span className="text-xs font-normal text-navy-600">dus, inchangés</span>
        </p>
      )}
    </div>
  );
}

/** Frais d'une facture prise seule — recalculés à l'affichage plutôt que
 *  stockés dans le jeu de données : un montant de frais figé dans une liste
 *  survivrait à un changement de barème sans que rien ne le signale. */
function fraisDeLaFacture(facture: FactureDemo): string {
  return portefeuilleDemo([facture]).fraisCentimes;
}
