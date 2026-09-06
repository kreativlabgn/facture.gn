"use client";

import Link from "next/link";
import { useRef } from "react";
import { logoutAction } from "@/app/(app)/actions";
import type { NavEntry } from "@/lib/nav";
import { CloseIcon, MoreIcon } from "./icons";
import { tabItemClasses } from "./tabStyles";

// Tiroir « Plus » : tout ce qui ne mérite pas un onglet permanent (Produits,
// Paramètres, espace cabinet, déconnexion). Les entrées arrivent DÉJÀ filtrées
// par permission (voir nav.ts, appelé côté serveur) — ce composant n'a aucune
// décision d'autorisation à prendre, il affiche ce qu'on lui donne.
//
// <dialog> natif plutôt qu'un overlay maison : la fermeture par Échap, le
// piège de focus et l'inertie de l'arrière-plan sont fournis par le
// navigateur. Les réimplémenter à la main, c'est les réimplémenter à moitié.
export function MoreDrawer({
  entries,
  active,
  cabinetHref,
}: {
  entries: readonly NavEntry[];
  active: boolean;
  // null quand l'utilisateur n'appartient à aucun cabinet — l'entrée
  // disparaît alors, elle ne s'affiche pas grisée : un lien mort n'informe
  // personne. Ne dépend pas d'un rôle d'organisation (PracticeMember est un
  // concept d'appartenance séparé, voir schema.prisma), d'où le passage par
  // une prop plutôt que par les permissions.
  cabinetHref: string | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        className={tabItemClasses(active)}
        onClick={() => dialogRef.current?.showModal()}
      >
        <MoreIcon />
        Plus
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Plus d'options"
        className="fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none rounded-t-2xl bg-white p-0 text-navy-950 backdrop:bg-navy-950/40"
        // Clic sur le fond : la cible de l'événement n'est le <dialog>
        // lui-même que hors de son contenu — c'est la façon standard de
        // distinguer le backdrop sans lui poser d'élément dédié.
        onClick={(event) => {
          if (event.target === dialogRef.current) {
            dialogRef.current?.close();
          }
        }}
      >
        <div className="flex items-center justify-between border-b border-navy-50 px-5 py-4">
          <h2 className="font-display text-base font-semibold">Plus</h2>
          <button
            type="button"
            aria-label="Fermer"
            className="rounded-lg p-2 text-navy-600 transition hover:bg-navy-50 hover:text-navy-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
            onClick={() => dialogRef.current?.close()}
          >
            <CloseIcon />
          </button>
        </div>

        <nav className="flex flex-col pb-[env(safe-area-inset-bottom)]">
          {entries.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              onClick={() => dialogRef.current?.close()}
              className="min-h-[52px] border-b border-navy-50 px-5 py-4 text-sm font-medium transition hover:bg-navy-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy-950"
            >
              {entry.label}
            </Link>
          ))}

          {cabinetHref ? (
            <Link
              href={cabinetHref}
              onClick={() => dialogRef.current?.close()}
              className="min-h-[52px] border-b border-navy-50 px-5 py-4 text-sm font-medium transition hover:bg-navy-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy-950"
            >
              Espace cabinet
            </Link>
          ) : null}

          <form action={logoutAction}>
            <button
              type="submit"
              className="min-h-[52px] w-full px-5 py-4 text-left text-sm font-medium text-bad-text transition hover:bg-bad-bg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy-950"
            >
              Se déconnecter
            </button>
          </form>
        </nav>
      </dialog>
    </>
  );
}
