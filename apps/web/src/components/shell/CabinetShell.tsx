"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { switchPracticeAction } from "@/app/cabinet/actions";
import { Wordmark } from "@/components/Wordmark";
import { cabinetPageTitle, PRACTICE_TYPE_LABELS, practiceRoleLabel } from "@/lib/cabinet-nav";
import { CabinetNav } from "./CabinetNav";
import { ExitIcon, SwitchIcon } from "./cabinet-icons";

// Coquille de l'espace cabinet.
//
// ELLE EST DÉLIBÉRÉMENT SOMBRE, quand l'espace marchand est clair. Ce n'est pas
// une préférence graphique : un même compte peut être à la fois propriétaire de
// son commerce et collaborateur d'un cabinet, et le tiroir « Plus » fait passer
// de l'un à l'autre en un clic. Sans rupture visuelle, on change de monde sans
// s'en apercevoir — et l'on croit à une fuite de données là où l'accès est
// parfaitement légitime. Le fond est le premier signal ; le bloc « Espace
// actif », en bas de la barre, est le second, et il est permanent.
//
// Deux rendus d'une seule navigation :
//   ≥ lg   barre latérale permanente — un cabinet travaille sur écran large.
//   < lg   tiroir replié, ouvert par un <details> NATIF et non un <dialog>
//          showModal() : ce dernier exige JavaScript, un <details> se déplie
//          sans une ligne de script.

export interface PracticeOption {
  id: string;
  name: string;
  type: string;
  role: string;
}

export function CabinetShell({
  practices,
  active,
  aUneOrganisation,
  children,
}: {
  practices: readonly PracticeOption[];
  active: PracticeOption;
  /** Vrai si le compte possède aussi au moins une organisation marchande. Le
   *  lien de retour n'a aucun sens pour un collaborateur sans commerce à lui —
   *  il le renverrait vers l'onboarding. */
  aUneOrganisation: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const titre = cabinetPageTitle(pathname) ?? "Espace cabinet";

  return (
    <div className="flex min-h-full bg-navy-50">
      <aside className="hidden w-64 shrink-0 flex-col bg-navy-950 lg:flex">
        <BarreLaterale practices={practices} active={active} aUneOrganisation={aUneOrganisation} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-navy-100 bg-white">
          <div className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="lg:hidden">
                <Wordmark href="/cabinet" ariaLabel="facture.gn — Accueil cabinet" />
              </span>
              <p className="hidden truncate font-display text-lg font-bold text-navy-950 lg:block">
                {titre}
              </p>
            </div>
            <div className="min-w-0 text-right">
              <p className="truncate text-sm font-semibold text-navy-950">{active.name}</p>
              <p className="truncate text-xs text-navy-600">
                {PRACTICE_TYPE_LABELS[active.type] ?? active.type} · {practiceRoleLabel(active.role)}
              </p>
            </div>
          </div>
        </header>

        {/* Tiroir mobile. aria-label distinct de la barre latérale : deux <nav>
            homonymes rendraient la liste des repères illisible au lecteur
            d'écran. */}
        <details className="bg-navy-950 lg:hidden">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-or">
            {titre}
          </summary>
          <div className="px-2 pb-3">
            <BarreLaterale
              practices={practices}
              active={active}
              aUneOrganisation={aUneOrganisation}
              variante="tiroir"
            />
          </div>
        </details>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function BarreLaterale({
  practices,
  active,
  aUneOrganisation,
  variante = "laterale",
}: {
  practices: readonly PracticeOption[];
  active: PracticeOption;
  aUneOrganisation: boolean;
  variante?: "laterale" | "tiroir";
}) {
  const tiroir = variante === "tiroir";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {tiroir ? null : (
        <div className="px-5 py-5">
          <Wordmark href="/cabinet" ariaLabel="facture.gn — Accueil cabinet" tone="dark" />
        </div>
      )}

      <nav
        aria-label={tiroir ? "Navigation du cabinet (tiroir)" : "Navigation du cabinet"}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
      >
        <CabinetNav role={active.role} />
      </nav>

      {/* ESPACE ACTIF — le bloc qui répond en permanence à « où suis-je ? ».
          C'est la contrepartie de la bascule en un clic depuis le tableau de
          bord marchand : on ne peut plus se tromper de cabinet sans le voir. */}
      <div className="border-t border-white/10 px-2 py-3">
        {practices.length > 1 ? (
          <details>
            <summary className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-or">
              <Initiale nom={active.name} />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-semibold text-white">{active.name}</span>
                <span className="block text-xs text-or">Espace actif</span>
              </span>
              <span className="shrink-0 text-white/45">
                <SwitchIcon />
              </span>
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5">
              {practices.map((practice) => (
                <li key={practice.id}>
                  <form action={switchPracticeAction}>
                    <input type="hidden" name="practiceId" value={practice.id} />
                    <button
                      type="submit"
                      aria-current={practice.id === active.id ? "true" : undefined}
                      className={[
                        "min-h-[42px] w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
                        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-or",
                        practice.id === active.id
                          ? "bg-white/10 text-white"
                          : "text-white/65 hover:bg-white/5 hover:text-white",
                      ].join(" ")}
                    >
                      <span className="block truncate">{practice.name}</span>
                      <span className="block truncate text-xs text-white/45">
                        {PRACTICE_TYPE_LABELS[practice.type] ?? practice.type} ·{" "}
                        {practiceRoleLabel(practice.role)}
                      </span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
            <Initiale nom={active.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white">{active.name}</span>
              <span className="block text-xs text-or">Espace actif</span>
            </span>
          </div>
        )}

        {aUneOrganisation ? (
          <Link
            href="/dashboard"
            className="mt-1 flex min-h-[42px] items-center gap-3 rounded-lg px-3 text-sm font-medium text-white/65 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-or"
          >
            <span className="text-white/45">
              <ExitIcon />
            </span>
            Retour à mon commerce
          </Link>
        ) : null}
      </div>
    </div>
  );
}

// Pastille d'initiale. Fond Or, lettre Navy — jamais l'inverse : du texte clair
// sur l'Or de Guinée plafonne à 1.8:1 (R-11).
function Initiale({ nom }: { nom: string }) {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-or font-display text-sm font-bold text-navy-950"
    >
      {nom.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
