"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logoutAction } from "@/app/(app)/actions";
import { isTabActive, type NavEntry } from "@/lib/nav";
import { roleLabel } from "@/lib/permissions";
import type { OrganizationSummary } from "@/lib/trust-api";
import { CabinetIcon, LogoutIcon, MenuIcon, TabIcon } from "./icons";

// Barre latérale de l'espace connecté — DESKTOP UNIQUEMENT (`hidden md:flex`).
//
// À partir de `md`, la barre basse passe en `md:hidden` : la navigation du
// pouce cède la place à un rail permanent, où l'œil la cherche sur un écran
// large. Les entrées arrivent DÉJÀ filtrées par permission (nav.ts, appelé
// côté serveur dans le layout) — ce composant n'a aucune décision
// d'autorisation à prendre, il affiche ce qu'on lui donne, dans l'ordre où on
// le lui donne. Même source que BottomTabBar et MoreDrawer : un rendu de plus
// d'une seule vérité, jamais une deuxième liste à tenir synchronisée.
//
// Rétractable : repliée, elle ne garde que les icônes (les libellés passent en
// `sr-only`, le lecteur d'écran les lit encore ; `title` les rend au survol).
// L'état n'est pas persisté — une préférence d'affichage n'est pas une donnée,
// et un rail qui s'ouvre au même endroit à chaque session est prévisible.
//
// Un seul repère « Navigation principale » est exposé à un instant donné :
// celui-ci au-dessus de `md`, BottomTabBar en dessous (`display:none` retire
// l'élément de l'arbre d'accessibilité).
export function SidebarNavigation({
  tabs,
  moreEntries,
  cabinetHref,
  active,
}: {
  tabs: readonly NavEntry[];
  moreEntries: readonly NavEntry[];
  // null quand l'utilisateur n'appartient à aucun cabinet — l'entrée disparaît
  // alors, elle ne s'affiche pas grisée : un lien mort n'informe personne.
  // Ne dépend pas d'un rôle d'organisation (PracticeMember est un concept
  // d'appartenance séparé), d'où une prop plutôt qu'une permission.
  cabinetHref: string | null;
  active: OrganizationSummary;
}) {
  const pathname = usePathname();
  const [reduite, setReduite] = useState(false);

  // Le seuil cabinet (/dashboard/espace-cabinet) n'est pas dans nav.ts :
  // activeHref() le rattacherait à /dashboard et « Accueil » s'allumerait à sa
  // place. On le tranche ici, et il prend le pas sur les onglets.
  const cabinetActif =
    cabinetHref !== null && (pathname === cabinetHref || pathname.startsWith(`${cabinetHref}/`));

  return (
    <aside
      aria-label="Barre latérale"
      className={[
        "hidden h-full shrink-0 flex-col border-r border-navy-800 bg-navy-950 text-white md:flex",
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        reduite ? "w-16" : "w-64",
      ].join(" ")}
    >
      <div className={`flex items-center px-2 pt-3 pb-1 ${reduite ? "justify-center" : "justify-end"}`}>
        <button
          type="button"
          aria-expanded={!reduite}
          aria-label={reduite ? "Développer la barre latérale" : "Réduire la barre latérale"}
          onClick={() => setReduite((valeur) => !valeur)}
          className="rounded-lg p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-or"
        >
          <MenuIcon />
        </button>
      </div>

      <nav aria-label="Navigation principale" className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2">
        {tabs.map((entry) => (
          <Entree
            key={entry.href}
            href={entry.href}
            label={entry.label}
            actif={!cabinetActif && isTabActive(pathname, entry.href)}
            reduite={reduite}
          />
        ))}

        {/* Le trait sépare ce qu'on fait tous les jours de ce qu'on règle de
            temps en temps. Purement décoratif : aria-hidden. */}
        {moreEntries.length > 0 || cabinetHref ? <hr aria-hidden="true" className="mx-2 my-2 border-navy-800" /> : null}

        {moreEntries.map((entry) => (
          <Entree
            key={entry.href}
            href={entry.href}
            label={entry.label}
            actif={!cabinetActif && isTabActive(pathname, entry.href)}
            reduite={reduite}
          />
        ))}

        {cabinetHref ? (
          <Entree
            href={cabinetHref}
            label="Espace cabinet"
            icone={<CabinetIcon />}
            actif={cabinetActif}
            reduite={reduite}
          />
        ) : null}
      </nav>

      {/* Pied : l'organisation active (fg_active_org, résolue côté serveur) et
          la déconnexion. Le rail couvre toute la hauteur — on doit savoir pour
          quelle entreprise on navigue avant de cliquer. Le changement
          d'organisation reste dans l'en-tête (OrgSwitcher), un formulaire qui
          fonctionne sans JavaScript ; ici on rappelle, on ne bascule pas. */}
      <div className="border-t border-navy-800 px-2 py-3">
        <div className={reduite ? "sr-only" : "px-3 pb-2"}>
          <p className="truncate font-display text-sm font-semibold">{active.name}</p>
          <p className="mt-0.5 truncate text-xs text-white/70">{roleLabel(active.role)}</p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            title={reduite ? "Se déconnecter" : undefined}
            className={[
              "flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-white/70",
              "transition-colors hover:bg-white/10 hover:text-white",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-or",
              reduite ? "justify-center" : "",
            ].join(" ")}
          >
            <LogoutIcon />
            <span className={reduite ? "sr-only" : "truncate"}>Se déconnecter</span>
          </button>
        </form>
      </div>
    </aside>
  );
}

// L'état actif ne tient pas qu'à la couleur : un liseré Or à gauche le double
// (WCAG 1.4.1 — jamais la couleur comme unique vecteur d'information), et
// aria-current le porte pour les lecteurs d'écran.
function Entree({
  href,
  label,
  actif,
  reduite,
  icone,
}: {
  href: string;
  label: string;
  actif: boolean;
  reduite: boolean;
  // Par défaut l'icône vient de la table href → icône d'icons.tsx ; l'entrée
  // cabinet, hors nav.ts, apporte la sienne.
  icone?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={actif ? "page" : undefined}
      title={reduite ? label : undefined}
      className={[
        "mx-2 flex min-h-[44px] items-center gap-3 rounded-lg border-l-2 px-3 text-sm font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-or",
        reduite ? "justify-center" : "",
        actif
          ? "border-l-or bg-white/10 text-white"
          : "border-l-transparent text-white/70 hover:bg-white/5 hover:text-white",
      ].join(" ")}
    >
      <span className="shrink-0">{icone ?? <TabIcon href={href} />}</span>
      <span className={reduite ? "sr-only" : "truncate"}>{label}</span>
    </Link>
  );
}
