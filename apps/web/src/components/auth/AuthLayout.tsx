import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";
import { AUTH_CONTEXTES, type AuthTuile } from "@/lib/auth-contexte";
import type { EspaceId } from "@/lib/espaces";

// Coquille des écrans d'entrée (connexion, inscription, tunnel OTP), commune
// aux trois profils. Écran scindé : une colonne d'ACTION blanche qui reçoit le
// formulaire, une zone d'INFORMATION en Navy qui dit, en tuiles, ce que
// l'utilisateur va trouver de l'autre côté — et qui lui laisse deux sorties si
// ce n'est pas sa porte.
//
// ── ORDRE DOM ≠ ORDRE VISUEL, et c'est voulu ─────────────────────────────────
// Le formulaire vient EN PREMIER dans le DOM : sur téléphone, où la page est
// une colonne, c'est ce que l'utilisateur voit sans défiler ; au lecteur
// d'écran, c'est ce qu'il vient faire. Sur `lg`, la grille place l'information
// à GAUCHE (col-start-1) et l'action à droite : l'œil lit le contexte, puis
// agit. Aucun `order-*` : la grille positionne, le DOM reste sémantique.
//
// ── COULEURS ─────────────────────────────────────────────────────────────────
// Zone d'information sur Navy 950 : texte blanc et blanc/75, tuiles en blanc/5
// cerclées blanc/10 — la même matière que la section « Contrôle public » de la
// landing. L'Or n'y sert qu'en accent (numéros d'étape, point de la marque) et
// toujours avec du Navy dessus, jamais du blanc (R-11). La colonne d'action
// est blanche, sans carte imbriquée : le formulaire EST la carte.
//
// ── SORTIES ──────────────────────────────────────────────────────────────────
// « Changer de profil » (→ /#espaces) et « Retour à l'accueil » (→ /) sont dans
// la barre haute sur mobile et en pied de la zone d'information sur desktop —
// discrets, mais présents à chaque taille. Quelqu'un qui s'est trompé de porte
// ne doit jamais avoir à taper l'URL de l'accueil.

const SORTIES = [
  { href: "/#espaces", label: "Changer de profil" },
  { href: "/", label: "Retour à l'accueil" },
] as const;

function Tuile({ tuile }: { tuile: AuthTuile }) {
  return (
    <li
      className={`rounded-2xl border border-white/10 bg-white/5 p-5 ${tuile.large ? "sm:col-span-2" : ""}`}
    >
      {tuile.numero ? (
        <span
          aria-hidden="true"
          className="inline-flex size-7 items-center justify-center rounded-full bg-or font-mono text-xs font-bold text-navy-950"
        >
          {tuile.numero}
        </span>
      ) : (
        <span aria-hidden="true" className="block h-1.5 w-6 rounded-full bg-or" />
      )}
      <h3 className="mt-3 font-display text-base font-bold text-white">
        {tuile.numero ? <span className="sr-only">Étape {tuile.numero} : </span> : null}
        {tuile.titre}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-white/75">{tuile.texte}</p>
    </li>
  );
}

function Sorties({ tone }: { tone: "light" | "dark" }) {
  const classes =
    tone === "dark"
      ? "text-white/75 hover:text-white focus-visible:outline-or"
      : "text-navy-600 hover:text-navy-950 focus-visible:outline-navy-950";
  return (
    <nav aria-label="Autres entrées" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
      {SORTIES.map((sortie) => (
        <Link
          key={sortie.href}
          href={sortie.href}
          className={`rounded-md underline-offset-4 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 ${classes}`}
        >
          {sortie.label}
        </Link>
      ))}
    </nav>
  );
}

export function AuthLayout({ role, children }: { role: EspaceId; children: ReactNode }) {
  const contexte = AUTH_CONTEXTES[role];

  return (
    <div className="flex min-h-full flex-col bg-white text-navy-950 lg:grid lg:min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Barre haute — mobile et tablette seulement. Sur lg, la marque et les
          sorties vivent dans la zone d'information. */}
      <header className="flex items-center justify-between gap-4 border-b border-navy-100 px-4 py-4 sm:px-6 lg:hidden">
        <Wordmark href="/" ariaLabel="facture.gn — Accueil" />
        <Sorties tone="light" />
      </header>

      {/* Colonne d'ACTION — première dans le DOM, à droite sur lg. */}
      <main className="flex flex-1 flex-col justify-center px-4 py-10 sm:px-6 lg:col-start-2 lg:row-start-1 lg:px-12 lg:py-16">
        <div className="mx-auto w-full max-w-md">{children}</div>
      </main>

      {/* Zone d'INFORMATION — à gauche sur lg, sous le formulaire sinon. */}
      <aside
        aria-label={contexte.eyebrow}
        className="flex flex-col bg-navy-950 px-4 py-10 text-white sm:px-6 lg:col-start-1 lg:row-start-1 lg:px-12 lg:py-12"
      >
        <div className="hidden lg:block">
          <Wordmark href="/" ariaLabel="facture.gn — Accueil" tone="dark" />
        </div>

        <div className="lg:my-auto lg:py-10">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-white/75">{contexte.eyebrow}</p>
          {/* h2 : le h1 de la page est le titre du formulaire, dans la colonne
              d'action — c'est lui que l'utilisateur vient chercher. */}
          <h2 className="mt-3 font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{contexte.titre}</h2>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/75 sm:text-base">{contexte.accroche}</p>

          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {contexte.tuiles.map((tuile) => (
              <Tuile key={tuile.titre} tuile={tuile} />
            ))}
          </ul>

          {contexte.lien ? (
            <Link
              href={contexte.lien.href}
              className="mt-6 inline-flex items-center gap-2 rounded-md text-sm font-semibold text-white underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-or"
            >
              {contexte.lien.label}
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 10h12m-5-5 5 5-5 5" />
              </svg>
            </Link>
          ) : null}
        </div>

        <div className="mt-10 hidden lg:block">
          <Sorties tone="dark" />
        </div>
      </aside>
    </div>
  );
}
