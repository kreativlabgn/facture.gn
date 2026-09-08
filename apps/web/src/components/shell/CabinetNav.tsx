"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCabinetNavActive, visibleCabinetGroups, type CabinetIconName } from "@/lib/cabinet-nav";
import {
  ClientsIcon,
  MandateIcon,
  OverviewIcon,
  PracticeIcon,
  TeamIcon,
} from "./cabinet-icons";

// Client uniquement pour connaître le chemin courant. Les liens eux-mêmes sont
// rendus côté serveur : sans JavaScript la navigation reste entièrement
// fonctionnelle, seul le marquage de l'entrée active manque.
//
// L'état actif est porté par TROIS signaux — un rail Or, un fond, et un
// aria-current — jamais par la seule couleur du texte (WCAG 1.4.1). Le rail est
// un aplat sans texte : l'Or ne porte jamais d'écriture claire (R-11, 1.8:1).

const ICONES: Record<CabinetIconName, () => React.JSX.Element> = {
  overview: OverviewIcon,
  clients: ClientsIcon,
  mandate: MandateIcon,
  team: TeamIcon,
  practice: PracticeIcon,
};

export function CabinetNav({
  role,
  onNaviguer,
}: {
  role: string;
  /** Referme le tiroir mobile après un clic. Absent sur la barre latérale, qui
   *  ne se referme jamais. */
  onNaviguer?: () => void;
}) {
  const pathname = usePathname();
  const groupes = visibleCabinetGroups(role);

  return (
    <div className="flex flex-col gap-5">
      {groupes.map((groupe, index) => (
        <div key={groupe.title ?? `groupe-${index}`} className="flex flex-col gap-1">
          {groupe.title ? (
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-white/45 uppercase">
              {groupe.title}
            </p>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {groupe.entries.map((entree) => {
              const actif = isCabinetNavActive(pathname, entree.href);
              const Icone = ICONES[entree.icon];
              return (
                <li key={entree.href}>
                  <Link
                    href={entree.href}
                    aria-current={actif ? "page" : undefined}
                    onClick={onNaviguer}
                    className={[
                      "relative flex min-h-[42px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                      "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-or",
                      actif
                        ? "bg-white/10 text-white"
                        : "text-white/65 hover:bg-white/5 hover:text-white",
                    ].join(" ")}
                  >
                    {actif ? (
                      <span
                        aria-hidden
                        className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r bg-or"
                      />
                    ) : null}
                    <span className={actif ? "text-or" : "text-white/45"}>
                      <Icone />
                    </span>
                    {entree.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
