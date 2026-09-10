import Link from "next/link";
import {
  CABINET_DEMO,
  MANDATS_CABINET_DEMO,
  MARCHAND_DEMO,
  PORTAIL_DEMO,
  checkoutDemo,
  portefeuilleDemo,
} from "@/lib/demo-accounts";
import { formatGnf } from "@/lib/format";
import { pourcentage, tierLabel } from "@/lib/plans";

// ─────────────────────────────────────────────────────────────────────────────
// ENCADRÉ DES COMPTES DE DÉMONSTRATION.
//
// ── DEUX PORTES, ANNONCÉES COMME TELLES ─────────────────────────────────────
// Le bouton ouvre l'écran peuplé sans rien demander ; les identifiants ouvrent
// le vrai compte. Les deux mènent aux mêmes chiffres, et c'est vérifié par un
// test (demo-seed.spec.ts) plutôt que promis par cette phrase.
//
// Ces identifiants ont d'abord été FAUX — affichés sous les mêmes libellés,
// mais n'ouvrant rien. Le visiteur allait sur /login, échouait, et concluait
// que la plateforme était en panne. On ne les a pas cachés : on les a rendus
// vrais (scripts/seed-demo-accounts.mjs). La règle apprise reste écrite ici
// pour la prochaine fois — un champ nommé « Mot de passe » est une invitation
// à se connecter, et aucun avertissement au-dessus n'empêche le geste.
//
// ── CE QUE CET ENCADRÉ DOIT ÊTRE ────────────────────────────────────────────
// Visiblement une démonstration, jamais confondable avec le vrai parcours. Le
// liseré Or, le titre explicite et la chasse fixe des identifiants font ce
// travail : un visiteur ne doit pas croire une seconde qu'il lit ses propres
// chiffres. C'est aussi pourquoi il vient APRÈS le choix de profil sur
// l'inscription et non avant — la vitrine ne prend pas la place de la porte.
// ─────────────────────────────────────────────────────────────────────────────

/** Bandeau posé en tête de chaque écran de démonstration.
 *
 *  Il n'est pas décoratif : c'est la seule chose qui empêche une capture
 *  d'écran de cette page de circuler comme une capture du produit. Le liseré Or
 *  et le mot « DÉMONSTRATION » en chasse fixe survivent au recadrage.
 *
 *  `ton` suit le fond de l'écran hôte — la console cabinet est intégralement
 *  Navy, où un bandeau clair ferait une bande blanche en travers. */
export function BandeauDemo({
  children,
  ton = "clair",
}: {
  children: React.ReactNode;
  ton?: "clair" | "sombre";
}) {
  const sombre = ton === "sombre";

  return (
    <div
      className={[
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border-2 border-or p-4",
        sombre ? "bg-white/5" : "bg-white",
      ].join(" ")}
    >
      <span className="inline-flex shrink-0 items-center rounded-full bg-or px-2.5 py-1 font-mono text-[11px] font-bold tracking-wide text-navy-950 uppercase">
        Démonstration
      </span>
      <p className={["text-xs leading-relaxed", sombre ? "text-white/75" : "text-navy-600"].join(" ")}>
        {children}
      </p>
    </div>
  );
}

/** Un identifiant de scénario. En chasse fixe, comme tout ce qui se recopie
 *  chiffre par chiffre : le mono lève l'ambiguïté 0/O et 1/l. */
function Identifiant({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-navy-600">{libelle}</dt>
      <dd className="font-mono text-xs font-bold text-navy-950">{valeur}</dd>
    </div>
  );
}

function Puce({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs leading-relaxed text-navy-600">
      <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-or" />
      {children}
    </li>
  );
}

function CarteScenario({
  numero,
  titre,
  sousTitre,
  identifiants,
  faits,
  href,
  cta,
  connexion = false,
}: {
  numero: string;
  titre: string;
  sousTitre: string;
  identifiants: { libelle: string; valeur: string }[];
  faits: React.ReactNode[];
  href: string;
  cta: string;
  /** Ce scénario a-t-il un compte réel derrière lui ? */
  connexion?: boolean;
}) {
  return (
    <article className="flex flex-col rounded-xl border border-navy-100 bg-white p-5">
      <p className="font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
        Scénario {numero}
      </p>
      <h3 className="mt-1 font-display text-base font-semibold text-navy-950">{titre}</h3>
      <p className="mt-1 text-xs leading-relaxed text-navy-600">{sousTitre}</p>

      <dl className="mt-4 flex flex-col gap-2 rounded-lg border border-navy-100 bg-grey p-3">
        {identifiants.map((identifiant) => (
          <Identifiant key={identifiant.libelle} {...identifiant} />
        ))}
      </dl>

      <ul className="mt-4 flex flex-col gap-2">
        {faits.map((fait, index) => (
          <Puce key={index}>{fait}</Puce>
        ))}
      </ul>

      {/* mt-auto : les trois boutons s'alignent quelle que soit la longueur des
          listes au-dessus, sans hauteur fixe qui tronquerait. */}
      <div className="mt-auto flex flex-col gap-2 pt-5">
        <Link
          href={href}
          className="flex min-h-[40px] w-full items-center justify-center rounded-[10px] border border-navy-200 bg-white px-4 text-sm font-semibold text-navy-950 transition hover:bg-navy-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
        >
          {cta}
        </Link>
        {/* La seconde porte, seulement là où un compte existe : le guichet de
            paiement est public par nature, proposer d'y « se connecter »
            n'aurait aucun sens. */}
        {connexion ? (
          <Link
            href="/login"
            className="flex min-h-[40px] w-full items-center justify-center rounded-[10px] px-4 text-sm font-semibold text-navy-600 underline underline-offset-2 transition hover:text-navy-950"
          >
            Se connecter au compte
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export function ComptesDemo() {
  const portefeuille = portefeuilleDemo();
  const checkout = checkoutDemo(PORTAIL_DEMO.invoiceId);

  return (
    <section
      aria-labelledby="comptes-demo"
      className="rounded-2xl border-2 border-or bg-grey p-6 sm:p-8"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          {/* Pastille Or : le Navy sur l'Or vaut 9.4:1 (R-11). Jamais de blanc
              ici — il tomberait à 1.8:1. */}
          <span className="inline-flex items-center rounded-full bg-or px-2.5 py-1 font-mono text-[11px] font-bold tracking-wide text-navy-950 uppercase">
            Démonstration
          </span>
          <h2
            id="comptes-demo"
            className="mt-3 font-display text-lg font-bold tracking-tight text-navy-950 sm:text-xl"
          >
            Voir la plateforme peuplée, sans créer de compte
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-navy-600">
            Trois scénarios pré-remplis, chiffrés avec le barème réel. Le bouton ouvre l’écran
            <strong> sans rien demander</strong> ; les identifiants ouvrent le vrai compte, avec
            les mêmes chiffres. Ce sont des comptes partagés : n’y déposez rien de réel.
          </p>
        </div>
      </div>

      {/* Deux colonnes dès `sm`, trois seulement à `lg` : à 768 px, trois
          cartes portant chacune une liste d'identifiants tomberaient à ~240 px
          de large, et les montants passeraient à la ligne au milieu d'un
          nombre. La troisième colonne attend d'avoir la place. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CarteScenario
          numero="1"
          titre="Marchand — PME au palier gratuit"
          sousTitre={MARCHAND_DEMO.organisation}
          identifiants={[
            { libelle: "Téléphone", valeur: MARCHAND_DEMO.telephone },
            { libelle: "Mot de passe", valeur: MARCHAND_DEMO.motDePasse },
            { libelle: "Palier", valeur: tierLabel(MARCHAND_DEMO.tier) },
          ]}
          faits={[
            <>
              {portefeuille.facturesTotal} factures émises,{" "}
              {formatGnf(portefeuille.volumeCentimes)} de volume
            </>,
            <>
              {portefeuille.litiges} factures en litige, avec le fil de discussion du client
            </>,
            <>
              Taux effectif {pourcentage(portefeuille.tauxEffectifBps)} — sous le barème de{" "}
              {pourcentage(portefeuille.tauxBaremeBps)}, grâce au plafond
            </>,
          ]}
          href="/demo/marchand"
          cta="Ouvrir le tableau de bord"
          connexion
        />

        <CarteScenario
          numero="2"
          titre="Cabinet comptable — multi-mandats"
          sousTitre={CABINET_DEMO.raisonSociale}
          identifiants={[
            { libelle: "Téléphone", valeur: CABINET_DEMO.telephone },
            { libelle: "Mot de passe", valeur: CABINET_DEMO.motDePasse },
            // Un numéro d'inscription à l'Ordre est un attribut PUBLIC d'un
            // cabinet — il figure sur son papier à en-tête. Il n'ouvre rien, et
            // n'est plus présenté comme s'il le pouvait.
            { libelle: "N° OCAECG", valeur: CABINET_DEMO.numeroOcaecg },
          ]}
          faits={[
            <>{MANDATS_CABINET_DEMO.length} PME supervisées sous mandat</>,
            <>Statut « {CABINET_DEMO.statut} » — le badge de l’Ordre ne s’auto-décerne pas</>,
            <>Export FEC des écritures comptables</>,
          ]}
          href="/demo/cabinet"
          cta="Ouvrir la console cabinet"
          connexion
        />

        <CarteScenario
          numero="3"
          titre="Portail client — guichet de paiement"
          sousTitre={`Facture ${PORTAIL_DEMO.numero} · ${PORTAIL_DEMO.client}`}
          identifiants={[
            { libelle: "Lien public", valeur: `/pay/${PORTAIL_DEMO.invoiceId}` },
            {
              libelle: "À régler",
              valeur: checkout ? formatGnf(checkout.totalPayeur) : "—",
            },
          ]}
          faits={[
            <>
              {checkout ? formatGnf(checkout.marchandise) : "—"} de marchandise, frais fusionnés en
              une ligne
            </>,
            <>
              {checkout ? formatGnf(checkout.fraisTransaction) : "—"} de frais, soit{" "}
              {checkout ? pourcentage(checkout.tauxEffectifBps) : "—"}
            </>,
            <>Le bouton Mobile Money se ferme si la facture est réglée ou contestée</>,
          ]}
          href={`/pay/${PORTAIL_DEMO.invoiceId}`}
          cta="Ouvrir le guichet"
        />
      </div>
    </section>
  );
}
