"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CABINET_NAV, isCabinetNavActive } from "@/lib/cabinet-nav";

// Client uniquement pour connaître le chemin courant. Les liens eux-mêmes sont
// rendus côté serveur : sans JavaScript la navigation reste entièrement
// fonctionnelle, seul le marquage de l'entrée active manque.
//
// L'état actif est doublé d'un fond ET d'un aria-current, jamais d'une simple
// couleur de texte (WCAG 1.4.1 — la couleur seule ne signale pas un état).
export function CabinetNav({ orientation }: { orientation: "sidebar" | "drawer" }) {
  const pathname = usePathname();
  const layout = orientation === "sidebar" ? "flex-col gap-1" : "flex-col gap-1 p-2";

  return (
    <ul className={`flex ${layout}`}>
      {CABINET_NAV.map((entry) => {
        const active = isCabinetNavActive(pathname, entry.href);
        return (
          <li key={entry.href}>
            <Link
              href={entry.href}
              aria-current={active ? "page" : undefined}
              className={[
                "block rounded-lg px-3 py-2 text-sm font-medium transition",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950",
                active ? "bg-navy-50 text-navy-950" : "text-navy-600 hover:bg-navy-50 hover:text-navy-950",
              ].join(" ")}
            >
              {entry.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
