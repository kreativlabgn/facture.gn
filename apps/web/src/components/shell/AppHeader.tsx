import type { NavEntry } from "@/lib/nav";
import type { OrganizationSummary } from "@/lib/trust-api";
import { Wordmark } from "@/components/Wordmark";
import { NavDrawer } from "./NavDrawer";
import { OrgSwitcher } from "./OrgSwitcher";
import { PrimaryNav } from "./PrimaryNav";

// En-tête de la coquille : navigation latérale, marque, organisation active,
// et — à partir de `md` — les mêmes onglets que la barre basse. Une seule
// source (nav.ts) alimente tous ces rendus : sur téléphone la navigation
// principale est en bas, sous le pouce ; sur écran large elle remonte dans
// l'en-tête, où on la cherche.
//
// PrimaryNav est `hidden md:flex` et BottomTabBar `md:hidden` — jamais les
// deux à l'écran, jamais aucune des deux. `display:none` retirant l'élément
// de l'arbre d'accessibilité, un seul repère « Navigation principale » est
// exposé au lecteur d'écran à un instant donné.
//
// NavDrawer comble le trou symétrique : en disparaissant à `md`, la barre
// basse emportait le tiroir « Plus » qu'elle héberge, laissant Produits,
// Paramètres, le simulateur USSD, l'espace cabinet et LA DÉCONNEXION sans
// aucun point d'entrée sur ordinateur. Les onglets restent dans l'en-tête pour
// les trois destinations quotidiennes ; le tiroir porte tout le reste.
export function AppHeader({
  tabs,
  moreEntries,
  cabinetHref,
  organizations,
  active,
}: {
  tabs: readonly NavEntry[];
  moreEntries: readonly NavEntry[];
  cabinetHref: string | null;
  organizations: readonly OrganizationSummary[];
  active: OrganizationSummary;
}) {
  return (
    <header className="border-b border-navy-100 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-1">
          {/* -ml-2 compense le padding du bouton : le glyphe s'aligne sur la
              marge du contenu, pas le rectangle cliquable qui la déborde. */}
          <div className="-ml-2">
            <NavDrawer tabs={tabs} moreEntries={moreEntries} cabinetHref={cabinetHref} active={active} />
          </div>
          <Wordmark href="/dashboard" ariaLabel="facture.gn — Accueil" />
        </div>
        <PrimaryNav tabs={tabs} />
        <OrgSwitcher organizations={organizations} active={active} />
      </div>
    </header>
  );
}
