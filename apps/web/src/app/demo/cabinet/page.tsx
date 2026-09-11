import type { Metadata } from "next";
import Link from "next/link";
import {
  CABINET_DEMO,
  MANDATS_CABINET_DEMO,
  facturesCabinetDemo,
  litigesCabinetDemo,
  volumeCabinetDemo,
  type MandatDemo,
} from "@/lib/demo-accounts";
import { formatDate, formatGnf } from "@/lib/format";
import { AnneauRepartition, BarresVolume, CloisonsEtanches } from "@/components/Illustrations";
import { BandeauDemo } from "@/components/ComptesDemo";
import { Wordmark } from "@/components/Wordmark";

export const metadata: Metadata = {
  title: "Démonstration — Console cabinet — facture.gn",
  robots: { index: false, follow: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// CONSOLE CABINET — DÉMONSTRATION.
//
// Navy plein, de bord à bord. Ce n'est pas un thème sombre au sens d'une
// préférence système : c'est le fond DE l'espace cabinet (CabinetShell), et il
// signale qu'on a changé de monde — on ne regarde plus ses propres factures,
// on regarde celles des autres, sous mandat.
//
// ── CONTRASTE SUR FOND SOMBRE ───────────────────────────────────────────────
// Sur Navy, le texte est blanc (`text-white`) ou blanc adouci (`text-white/75`,
// qui reste très au-dessus de 4.5:1), et les accents sont en Or. Jamais un
// `text-navy-*` : l'échelle Navy est faite d'opacités du Navy, invisibles sur
// leur propre couleur. Le seul Navy de l'écran est celui posé SUR l'Or, où il
// vaut 9.4:1 — l'inverse (blanc sur Or) tomberait à 1.8:1 et est interdit
// (R-11, vérifié par design-system.guardrails.spec.ts).
// ─────────────────────────────────────────────────────────────────────────────

export default function DemoCabinetPage() {
  const volume = volumeCabinetDemo();
  const factures = facturesCabinetDemo();
  const litiges = litigesCabinetDemo();

  return (
    <div className="flex min-h-full flex-col bg-navy-950 text-white">
      <header className="border-b border-navy-800">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Wordmark href="/" ariaLabel="facture.gn — Accueil" tone="dark" />
          <Link
            href="/inscription"
            className="text-sm font-semibold text-white underline underline-offset-2"
          >
            Quitter la démonstration
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6">
          <BandeauDemo ton="sombre">
            Cabinet <strong className="text-white">{CABINET_DEMO.numeroOcaecg}</strong> — données
            fictives. Aucun mandat réel n’est consulté : cet écran ne parle à aucune API.
          </BandeauDemo>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">
                {CABINET_DEMO.raisonSociale}
              </h1>
              <p className="mt-1 text-sm text-white/75">
                Membre depuis le {formatDate(CABINET_DEMO.depuis)} · Numéro OCAECG{" "}
                <span className="font-mono font-bold text-or">{CABINET_DEMO.numeroOcaecg}</span>
              </p>
            </div>

            {/* Badge Or mat — Navy sur Or (9.4:1). Il porte l'état BRUT
                (`PENDING_VERIFICATION`) et sa traduction juste en dessous :
                un cabinet qui prend une capture d'écran pour son dossier doit
                pouvoir citer le terme exact, et son client doit pouvoir le
                comprendre sans glossaire. */}
            <div className="text-right">
              <span className="inline-flex items-center gap-2 rounded-full bg-or px-3 py-1.5 font-mono text-[11px] font-bold tracking-wide text-navy-950 uppercase">
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M8 4.5v4M8 11h.01M8 1.8 14.5 5v4.2c0 3.2-2.7 5.4-6.5 6.6C4.2 14.6 1.5 12.4 1.5 9.2V5z"
                  />
                </svg>
                {CABINET_DEMO.statut}
              </span>
              <p className="mt-2 max-w-xs text-xs leading-relaxed text-white/75">
                En attente du contrôle de l’Ordre. Le badge « vérifié » ne s’auto-décerne pas.
              </p>
            </div>
          </div>

          {/* ── Compteurs du portefeuille ────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <CompteurSombre
              libelle="PME supervisées"
              valeur={String(MANDATS_CABINET_DEMO.length)}
              portee="sous mandat actif"
            />
            <CompteurSombre
              libelle="Volume supervisé"
              valeur={formatGnf(volume)}
              portee={`sur ${factures} factures`}
            />
            <CompteurSombre
              libelle="Contestations"
              valeur={String(litiges)}
              portee="à arbitrer avant clôture"
              alerte
            />
            <CompteurSombre libelle="Collaborateurs" valeur="4" portee="dont 1 expert-comptable" />
          </div>

          {/* ── Export FEC ───────────────────────────────────────────────── */}
          {/* Le déclencheur est un LIEN, pas un <button> : il pointe une route
              qui sert un fichier, donc c'est une navigation, pas une action. Un
              vrai fichier tabulé, 18 colonnes, qui s'ouvre dans un tableur. */}
          <section className="rounded-2xl border border-navy-800 bg-white/5 p-6 lg:p-8">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="max-w-2xl">
                <h2 className="font-display text-lg font-semibold">
                  Fichier des Écritures Comptables
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/75">
                  Format légal de l’article A47 A-1 du LPF : 18 colonnes tabulées, UTF-8, comptes
                  SYSCOHADA. Une écriture par mouvement — jamais une ligne agrégée par facture —
                  avec le règlement porté au journal de banque quand la facture a été encaissée.
                </p>
              </div>
              {/* `prefetch={false}` : sans lui, Next irait chercher la route au
                  survol du bouton, c'est-à-dire générerait le fichier pour
                  quelqu'un qui n'a pas encore cliqué. Un export se déclenche au
                  clic, jamais en passant devant. */}
              <Link
                href="/demo/cabinet/fec"
                prefetch={false}
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[10px] bg-or px-6 py-3 font-display text-base font-semibold text-navy-950 transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-or"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  aria-hidden="true"
                  className="h-5 w-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M12 3.5v11M8 11l4 3.5 4-3.5M4 16.5v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
                  />
                </svg>
                Exporter le FEC
              </Link>
            </div>
          </section>

          {/* ── Portefeuille ─────────────────────────────────────────────── */}
          <section className="rounded-2xl border border-navy-800 bg-white/5 p-6 lg:p-8">
            <h2 className="font-display text-lg font-semibold">Portefeuille de mandats</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/75">
              Un mandat par entreprise, accordé par elle et révocable par elle. Le rang indiqué est
              celui qu’elle vous a accordé chez elle — distinct du rang de vos collaborateurs dans
              le cabinet.
            </p>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-navy-800">
                    <ThSombre>Entreprise</ThSombre>
                    <ThSombre>Secteur</ThSombre>
                    <ThSombre align="right">Factures</ThSombre>
                    <ThSombre align="right">Volume</ThSombre>
                    <ThSombre align="right">Litiges</ThSombre>
                    <ThSombre>Mandat</ThSombre>
                  </tr>
                </thead>
                <tbody>
                  {MANDATS_CABINET_DEMO.map((mandat) => (
                    <LigneMandat key={mandat.organisation} mandat={mandat} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Répartition & étanchéité ─────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="flex flex-col items-center rounded-2xl border border-navy-800 bg-white/5 p-6">
              <h2 className="mb-4 self-start font-display text-base font-semibold">
                Volume par mandat
              </h2>
              <AnneauRepartition
                ton="sombre"
                total={String(MANDATS_CABINET_DEMO.length)}
                legende="MANDATS"
                parts={MANDATS_CABINET_DEMO.map((mandat, index) => ({
                  libelle: mandat.organisation,
                  valeur: Number(BigInt(mandat.volumeCentimes) / BigInt(100000)),
                  // Une seule teinte accentuée : le reste se distingue par
                  // l'ordre des arcs, pas par cinq couleurs qui feraient de
                  // l'anneau un arc-en-ciel sans hiérarchie.
                  trait: index === 1 ? "stroke-or" : "stroke-white",
                }))}
                className="h-44 w-44"
              />
              <dl className="mt-5 w-full">
                {MANDATS_CABINET_DEMO.map((mandat) => (
                  <div
                    key={mandat.organisation}
                    className="flex items-center justify-between gap-3 py-1"
                  >
                    <dt className="truncate text-xs text-white/75">{mandat.organisation}</dt>
                    <dd className="shrink-0 font-mono text-xs font-bold text-white">
                      {formatGnf(mandat.volumeCentimes)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="rounded-2xl border border-navy-800 bg-white/5 p-6 lg:col-span-2">
              <h2 className="font-display text-base font-semibold">
                Chaque dossier dans son compartiment
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                Vos cinq mandats ne partagent aucune donnée. La séparation est appliquée par la base
                sous chaque requête — une requête qui oublierait son filtre ne rend pas les lignes
                du voisin, elle n’en rend aucune.
              </p>
              <p className="mt-4 font-mono text-[11px] font-bold tracking-wide text-or uppercase">
                PostgreSQL · FORCE ROW LEVEL SECURITY
              </p>
              <CloisonsEtanches ton="sombre" className="mt-4 h-28 w-full sm:h-32" />
              <div className="mt-5">
                <h3 className="mb-3 text-xs font-semibold tracking-[0.14em] text-or uppercase">
                  Dépôts au guichet e-TVA, par mois
                </h3>
                <BarresVolume ton="sombre" valeurs={[112, 138, 129, 164, 151, 182, 197]} accentuer={6} />
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

function CompteurSombre({
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
        "rounded-2xl border bg-white/5 p-5",
        alerte ? "border-or" : "border-navy-800",
      ].join(" ")}
    >
      <p
        className={[
          "text-xs font-semibold tracking-[0.14em] uppercase",
          alerte ? "text-or" : "text-white/75",
        ].join(" ")}
      >
        {libelle}
      </p>
      <p className="mt-2 font-mono text-xl font-bold text-white">{valeur}</p>
      <p className="mt-1 text-xs text-white/75">{portee}</p>
    </div>
  );
}

function ThSombre({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={[
        "pb-3 text-xs font-semibold tracking-[0.14em] text-or uppercase",
        align === "right" ? "text-right" : "text-left",
      ].join(" ")}
    >
      {children}
    </th>
  );
}

function LigneMandat({ mandat }: { mandat: MandatDemo }) {
  return (
    <tr className="border-b border-navy-800 last:border-0">
      <td className="py-3 pr-4 text-sm font-semibold text-white">{mandat.organisation}</td>
      <td className="py-3 pr-4 text-sm text-white/75">{mandat.secteur}</td>
      <td className="py-3 pr-4 text-right font-mono text-sm text-white">{mandat.factures}</td>
      <td className="py-3 pr-4 text-right font-mono text-sm font-bold text-white">
        {formatGnf(mandat.volumeCentimes)}
      </td>
      <td className="py-3 pr-4 text-right">
        {/* Pas la pastille rouge du système ici : `bg-red-bg` est un rouge à
            12 % pensé pour un fond CLAIR — composité sur le Navy, il vire au
            bordeaux sombre et son texte assombri tombe sous le seuil AA. Sur
            fond sombre, l'alerte se dit en Or cerclé, qui vaut 9.4:1. */}
        {mandat.litiges > 0 ? (
          <span className="inline-flex items-center rounded-full border border-or px-2.5 py-1 font-mono text-[11px] font-bold text-or">
            {mandat.litiges}
          </span>
        ) : (
          <span className="font-mono text-sm text-white/75">—</span>
        )}
      </td>
      <td className="py-3 text-sm text-white/75">{mandat.role}</td>
    </tr>
  );
}
