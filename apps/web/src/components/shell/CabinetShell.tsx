import type { ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";
import { PRACTICE_TYPE_LABELS, practiceRoleLabel } from "@/lib/cabinet-nav";
import { CabinetNav } from "./CabinetNav";

// Coquille de l'espace cabinet (Chantier C). Deux rendus d'une seule
// navigation (CABINET_NAV) :
//
//   ≥ md   une barre latérale permanente — un cabinet travaille sur écran
//          large, la navigation n'a pas à être repliée.
//   < md   un tiroir replié par défaut.
//
// Le tiroir est un <details> natif, PAS un <dialog> ouvert par showModal()
// comme MoreDrawer : `showModal()` exige JavaScript, alors qu'un <details>
// se déplie sans une ligne de script. La contrainte de rendu sans JS de ce
// chantier tranche entre les deux.
export function CabinetShell({
  practiceName,
  practiceType,
  practiceRole,
  children,
}: {
  practiceName: string;
  practiceType: string;
  practiceRole: string;
  children: ReactNode;
}) {
  const typeLabel = PRACTICE_TYPE_LABELS[practiceType] ?? practiceType;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Wordmark href="/cabinet" ariaLabel="facture.gn — Accueil cabinet" />
          <div className="text-right text-sm">
            <p className="font-semibold text-navy-950">{practiceName}</p>
            <p className="text-xs text-navy-600">
              {typeLabel} · {practiceRoleLabel(practiceRole)}
            </p>
          </div>
        </div>
      </header>

      {/* Tiroir mobile : replié par défaut, déplié par le navigateur seul. */}
      <details className="border-b border-navy-100 bg-white md:hidden">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-navy-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950">
          Menu du cabinet
        </summary>
        <nav aria-label="Navigation du cabinet">
          <CabinetNav orientation="drawer" />
        </nav>
      </details>

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-4 py-8 sm:px-6">
        {/* Barre latérale de bureau. aria-label distinct du tiroir : deux <nav>
            homonymes rendraient la liste des repères illisible au lecteur
            d'écran. */}
        <aside className="hidden w-52 shrink-0 md:block">
          <nav aria-label="Navigation du cabinet (barre latérale)">
            <CabinetNav orientation="sidebar" />
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
