"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";
import { cabinetPageTitle, PRACTICE_TYPE_LABELS, practiceRoleLabel } from "@/lib/cabinet-nav";
import { CabinetSidebar, type PracticeOption } from "./CabinetSidebar";
import { MenuIcon } from "./icons";

// Coquille de l'espace cabinet.
//
// ELLE EST DÉLIBÉRÉMENT SOMBRE, quand l'espace marchand est clair. Ce n'est pas
// une préférence graphique : un même compte peut être à la fois propriétaire de
// son commerce et collaborateur d'un cabinet. Sans rupture visuelle, on change
// de monde sans s'en apercevoir — et l'on croit à une fuite de données là où
// l'accès est parfaitement légitime. Le fond est le premier signal ; le bloc
// « Espace actif », en bas de la barre, est le second, et il est permanent.
//
// Deux rendus d'une seule navigation :
//   ≥ md   rail permanent — le seuil est à 768px : au-delà, 256px de barre
//          laissent encore 512px de contenu, et un cabinet qui saisit des
//          écritures sur tablette n'a pas à rouvrir un tiroir à chaque écran.
//   < md   tiroir replié derrière un burger, ouvert par un <details> NATIF et
//          non un <dialog> showModal() : ce dernier exige JavaScript, un
//          <details> se déplie sans une ligne de script.
//
// AUCUN CHEMIN DE RETOUR VERS L'ESPACE MARCHAND ne traverse cette coquille — ni
// ici, ni dans la barre : voir l'en-tête de CabinetSidebar, et la règle de
// non-régression dans cabinet-seuil.guardrails.spec.ts.

export type { PracticeOption } from "./CabinetSidebar";

export function CabinetShell({
  practices,
  active,
  children,
}: {
  practices: readonly PracticeOption[];
  active: PracticeOption;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const titre = cabinetPageTitle(pathname) ?? "Espace cabinet";
  const tiroir = useRef<HTMLDetailsElement>(null);

  // Le tiroir est un <details> non contrôlé : la navigation client de Next
  // préserve le DOM, donc sans ceci il resterait déplié par-dessus l'écran
  // qu'on vient d'ouvrir. Un effet plutôt qu'un état React, pour ne rien
  // changer au rendu serveur — sans JavaScript le tiroir reste simplement
  // ouvert, ce qui n'empêche rien.
  useEffect(() => {
    if (tiroir.current) {
      tiroir.current.open = false;
    }
  }, [pathname]);

  return (
    <div className="flex min-h-full bg-navy-50">
      <aside className="hidden w-64 shrink-0 flex-col bg-navy-950 md:flex">
        <CabinetSidebar practices={practices} active={active} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-navy-100 bg-white">
          <div className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="md:hidden">
                <Wordmark href="/cabinet" ariaLabel="facture.gn — Accueil cabinet" />
              </span>
              <p className="hidden truncate font-display text-lg font-bold text-navy-950 md:block">
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

        {/* Tiroir mobile et tablette. L'aria-label du <nav> est posé dans
            CabinetSidebar, distinct de celui du rail : deux <nav> homonymes
            rendraient la liste des repères illisible au lecteur d'écran.

            Le burger PORTE le titre de l'écran courant plutôt qu'un « Menu »
            générique : c'est la seule ligne visible quand le tiroir est replié,
            elle doit donc dire où l'on est autant qu'elle ouvre la navigation.
            44px de haut — la cible tactile tenue au doigt, pas au curseur. */}
        <details ref={tiroir} className="bg-navy-950 md:hidden">
          <summary className="flex min-h-[44px] cursor-pointer items-center gap-3 px-4 py-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-or">
            <span className="text-white/70">
              <MenuIcon />
            </span>
            {titre}
          </summary>
          <div className="px-2 pb-3">
            <CabinetSidebar
              practices={practices}
              active={active}
              variante="tiroir"
              onNaviguer={() => {
                if (tiroir.current) {
                  tiroir.current.open = false;
                }
              }}
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
