"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isTabActive, type NavEntry } from "@/lib/nav";

// Navigation horizontale de l'en-tête, à partir de `md`. Même source que la
// barre basse (nav.ts) et même règle d'onglet actif (isTabActive) — deux
// rendus d'une seule vérité, jamais deux listes à tenir synchronisées.
//
// Client uniquement pour le chemin courant. L'état actif est doublé d'un
// `aria-current="page"` et d'un fond, pas seulement d'une couleur de texte :
// la couleur seule ne signale pas un état (WCAG 1.4.1).
export function PrimaryNav({ tabs }: { tabs: readonly NavEntry[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigation principale" className="hidden gap-1 text-sm md:flex">
      {tabs.map((entry) => {
        const active = isTabActive(pathname, entry.href);
        return (
          <Link
            key={entry.href}
            href={entry.href}
            aria-current={active ? "page" : undefined}
            className={[
              "rounded-lg px-3 py-1.5 font-medium transition",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950",
              active ? "bg-navy-50 text-navy-950" : "text-navy-600 hover:bg-navy-50 hover:text-navy-950",
            ].join(" ")}
          >
            {entry.label}
          </Link>
        );
      })}
    </nav>
  );
}
