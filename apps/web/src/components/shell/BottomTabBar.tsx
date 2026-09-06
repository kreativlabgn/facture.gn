"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EMIT_ACTION, isMoreActive, isTabActive, type NavEntry } from "@/lib/nav";
import { PlusIcon, TabIcon } from "./icons";
import { MoreDrawer } from "./MoreDrawer";
import { tabItemClasses } from "./tabStyles";

// Barre d'onglets basse de la coquille ADR-095 :
//
//   Accueil · Factures · [ + Émettre ] · Clients · Plus
//
// Le FAB « Émettre » est posé AU MILIEU de la barre, surélevé — pas à droite
// comme un FAB Material. C'est l'action qui justifie l'application : sur un
// téléphone tenu à une main, le centre-bas est la zone que le pouce atteint
// sans se déplacer.
//
// Composant client parce qu'il lui faut le chemin courant (usePathname) pour
// allumer le bon onglet. Il ne prend AUCUNE décision d'autorisation : onglets
// et entrées du tiroir arrivent déjà filtrés par le layout serveur.
export function BottomTabBar({
  tabs,
  moreEntries,
  canEmit,
  cabinetHref,
  role,
}: {
  tabs: readonly NavEntry[];
  moreEntries: readonly NavEntry[];
  canEmit: boolean;
  cabinetHref: string | null;
  role: string;
}) {
  const pathname = usePathname();

  // Le tiroir n'apparaît que s'il a quelque chose à offrir — un onglet
  // « Plus » qui ouvre une liste vide est une promesse non tenue.
  const showMore = moreEntries.length > 0 || cabinetHref !== null;

  // Les onglets se répartissent de part et d'autre du FAB, « Plus » compté
  // avec ceux de droite puisqu'il y est rendu. Coupe à la moitié basse : sur
  // un nombre impair l'onglet en trop passe à droite, du côté de Plus, et la
  // barre reste équilibrée à l'œil. L'ordre de lecture reste celui de nav.ts.
  // Coquille complète : Accueil · Factures · [+] · Clients · Plus.
  // Variante lite (Factures masqué) : Accueil · [+] · Clients · Plus.
  const splitIndex = Math.floor((tabs.length + (showMore ? 1 : 0)) / 2);
  const leftItems = tabs.slice(0, splitIndex);
  const rightItems = tabs.slice(splitIndex);

  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-navy-100 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch">
        {leftItems.map((entry) => (
          <TabLink key={entry.href} entry={entry} active={isTabActive(pathname, entry.href)} />
        ))}

        {canEmit ? (
          <div className="flex flex-1 justify-center">
            <Link
              href={EMIT_ACTION.href}
              aria-label="Émettre une facture"
              className="-mt-5 flex h-14 w-14 flex-col items-center justify-center rounded-full border-4 border-white bg-or text-navy-950 transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
            >
              <PlusIcon />
            </Link>
          </div>
        ) : null}

        {rightItems.map((entry) => (
          <TabLink key={entry.href} entry={entry} active={isTabActive(pathname, entry.href)} />
        ))}

        {showMore ? (
          <MoreDrawer entries={moreEntries} cabinetHref={cabinetHref} active={isMoreActive(pathname, role)} />
        ) : null}
      </div>
    </nav>
  );
}

function TabLink({ entry, active }: { entry: NavEntry; active: boolean }) {
  return (
    <Link href={entry.href} aria-current={active ? "page" : undefined} className={tabItemClasses(active)}>
      <TabIcon href={entry.href} />
      {entry.label}
    </Link>
  );
}
