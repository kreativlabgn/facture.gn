"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Barre d'onglets du portail acheteur. Volontairement plus simple que celle du
// marchand (BottomTabBar) : pas de FAB, pas de tiroir, pas de variante lite —
// un acheteur consulte et paie, il n'émet rien.
//
// Deux rendus d'une seule liste, comme PrimaryNav et BottomTabBar côté
// marchand : `bar` en bas sur téléphone (ce portail s'ouvre presque toujours
// depuis un SMS, donc sur un mobile tenu à une main), `inline` dans l'en-tête
// sur écran large. Le layout n'en affiche jamais qu'un à la fois — `display:none`
// retirant l'élément de l'arbre d'accessibilité, un seul repère « Navigation du
// portail » est exposé au lecteur d'écran à un instant donné.
const ONGLETS = [
  { href: "/portail", label: "Accueil" },
  { href: "/portail/factures", label: "Mes factures" },
  { href: "/portail/aide", label: "Aide" },
  { href: "/portail/profil", label: "Profil" },
] as const;

export function PortalTabs({ mode }: { mode: "bar" | "inline" }) {
  const pathname = usePathname();
  const barre = mode === "bar";

  return (
    <nav
      aria-label="Navigation du portail"
      className={
        barre
          ? "fixed inset-x-0 bottom-0 z-40 border-t border-navy-100 bg-white pb-[env(safe-area-inset-bottom)]"
          : ""
      }
    >
      <div
        className={
          barre
            ? "mx-auto flex max-w-3xl items-stretch"
            : "mx-auto flex max-w-3xl gap-1 px-4 py-2 sm:px-6"
        }
      >
        {ONGLETS.map((onglet) => {
          // Égalité stricte sur l'accueil : sinon /portail/factures l'allumerait
          // aussi, tout commençant par /portail.
          const actif =
            onglet.href === "/portail" ? pathname === "/portail" : pathname.startsWith(onglet.href);
          return (
            <Link
              key={onglet.href}
              href={onglet.href}
              aria-current={actif ? "page" : undefined}
              className={[
                "font-medium transition",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy-950",
                barre
                  ? "flex min-h-[52px] flex-1 items-center justify-center border-t-2 px-2 text-[13px]"
                  : "rounded-lg px-3 py-1.5 text-sm",
                actif
                  ? barre
                    ? "border-t-navy-950 text-navy-950"
                    : "bg-navy-50 text-navy-950"
                  : barre
                    ? "border-t-transparent text-navy-600 hover:text-navy-950"
                    : "text-navy-600 hover:bg-navy-50 hover:text-navy-950",
              ].join(" ")}
            >
              {onglet.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
