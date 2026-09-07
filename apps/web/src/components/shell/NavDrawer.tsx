"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { logoutAction } from "@/app/(app)/actions";
import { isTabActive, type NavEntry } from "@/lib/nav";
import { roleLabel } from "@/lib/permissions";
import type { OrganizationSummary } from "@/lib/trust-api";
import { CloseIcon, MenuIcon } from "./icons";

// Tiroir de navigation latéral — DESKTOP UNIQUEMENT (`hidden md:*`).
//
// Il comble un trou, pas un manque de confort : à partir de `md`, la barre
// basse passe en `md:hidden` et emporte avec elle le tiroir « Plus » qu'elle
// héberge. Sur un navigateur d'ordinateur, Produits, Paramètres, le simulateur
// USSD, l'espace cabinet et LA DÉCONNEXION étaient donc simplement
// inatteignables. Sous `md`, rien ne change : la barre basse et son tiroir
// suivent la maquette consolidée et restent la navigation du pouce.
//
// <dialog> plutôt qu'un <div> translaté : la fermeture par Échap, le piège de
// focus et l'inertie de l'arrière-plan sont fournis par le navigateur. Un
// overlay maison les réimplémente toujours à moitié — même raison que
// MoreDrawer, dont ce composant est le pendant large.
//
// L'animation est pilotée par une classe posée APRÈS showModal() (une frame
// plus tard) : un <dialog> passe de display:none à block, et une transition
// déclenchée dans la même frame ne joue jamais. Elle se désactive d'elle-même
// sous prefers-reduced-motion.

const DUREE_MS = 200;

export function NavDrawer({
  tabs,
  moreEntries,
  cabinetHref,
  active,
}: {
  tabs: readonly NavEntry[];
  moreEntries: readonly NavEntry[];
  cabinetHref: string | null;
  active: OrganizationSummary;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();

  const ouvrir = useCallback(() => {
    dialogRef.current?.showModal();
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const fermer = useCallback(() => {
    setVisible(false);
    window.setTimeout(() => dialogRef.current?.close(), DUREE_MS);
  }, []);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label="Ouvrir la navigation"
        onClick={ouvrir}
        className="hidden items-center justify-center rounded-lg p-2 text-navy-950 transition-colors hover:bg-navy-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950 md:flex"
      >
        <MenuIcon />
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Navigation"
        // Échap ferme nativement : on repasse par `fermer()` pour que l'état
        // d'animation ne reste pas coincé à `true` derrière un dialog fermé.
        onCancel={(event) => {
          event.preventDefault();
          fermer();
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) {
            fermer();
          }
        }}
        className={[
          "fixed inset-y-0 left-0 m-0 h-full max-h-none w-72 max-w-[85vw] rounded-none",
          "border-r border-navy-800 bg-navy-950 p-0 text-white backdrop:bg-navy-950/50",
          "transition-transform duration-200 ease-out motion-reduce:transition-none",
          visible ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="flex h-full flex-col">
          {/* Rappel de l'organisation active : le tiroir couvre l'écran, on doit
              savoir pour quelle entreprise on navigue avant de cliquer. */}
          <div className="flex items-start justify-between gap-3 border-b border-navy-800 px-5 py-4">
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold">{active.name}</p>
              <p className="mt-0.5 text-xs text-white/70">{roleLabel(active.role)}</p>
            </div>
            <button
              type="button"
              aria-label="Fermer la navigation"
              onClick={fermer}
              className="-mr-1 shrink-0 rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-or"
            >
              <CloseIcon />
            </button>
          </div>

          <nav aria-label="Navigation du tiroir" className="flex flex-1 flex-col overflow-y-auto py-2">
            {tabs.map((entry) => (
              <Entree
                key={entry.href}
                href={entry.href}
                label={entry.label}
                actif={isTabActive(pathname, entry.href)}
                onNaviguer={fermer}
              />
            ))}

            {/* Le trait sépare ce qu'on fait tous les jours de ce qu'on règle
                de temps en temps. Purement décoratif : aria-hidden. */}
            {moreEntries.length > 0 || cabinetHref ? (
              <hr aria-hidden="true" className="my-2 border-navy-800" />
            ) : null}

            {moreEntries.map((entry) => (
              <Entree
                key={entry.href}
                href={entry.href}
                label={entry.label}
                actif={isTabActive(pathname, entry.href)}
                onNaviguer={fermer}
              />
            ))}

            {cabinetHref ? (
              <Entree
                href={cabinetHref}
                label="Espace cabinet"
                actif={pathname.startsWith("/cabinet")}
                onNaviguer={fermer}
              />
            ) : null}
          </nav>

          <div className="border-t border-navy-800 px-2 py-2">
            <form action={logoutAction}>
              <button
                type="submit"
                className="min-h-[44px] w-full rounded-lg px-3 text-left text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-or"
              >
                Se déconnecter
              </button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}

// L'état actif ne tient pas qu'à la couleur : un liseré Or à gauche le double
// (WCAG 1.4.1 — jamais la couleur comme unique vecteur d'information), et
// aria-current le porte pour les lecteurs d'écran.
function Entree({
  href,
  label,
  actif,
  onNaviguer,
}: {
  href: string;
  label: string;
  actif: boolean;
  onNaviguer: () => void;
}) {
  return (
    <Link
      href={href}
      aria-current={actif ? "page" : undefined}
      onClick={onNaviguer}
      className={[
        "mx-2 flex min-h-[44px] items-center rounded-lg border-l-2 px-3 text-sm font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-or",
        actif
          ? "border-l-or bg-white/10 text-white"
          : "border-l-transparent text-white/70 hover:bg-white/5 hover:text-white",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}
