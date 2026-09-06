import type { NavEntry } from "@/lib/nav";
import type { OrganizationSummary } from "@/lib/trust-api";
import { Wordmark } from "@/components/Wordmark";
import { OrgSwitcher } from "./OrgSwitcher";
import { PrimaryNav } from "./PrimaryNav";

// En-tête de la coquille : marque, organisation active, et — à partir de
// `md` — les mêmes onglets que la barre basse. Une seule source (nav.ts)
// alimente les deux : sur téléphone la navigation est en bas, sous le pouce ;
// sur écran large elle remonte dans l'en-tête, où on la cherche.
//
// PrimaryNav est `hidden md:flex` et BottomTabBar `md:hidden` — jamais les
// deux à l'écran, jamais aucune des deux. `display:none` retirant l'élément
// de l'arbre d'accessibilité, un seul repère « Navigation principale » est
// exposé au lecteur d'écran à un instant donné.
export function AppHeader({
  tabs,
  organizations,
  active,
}: {
  tabs: readonly NavEntry[];
  organizations: readonly OrganizationSummary[];
  active: OrganizationSummary;
}) {
  return (
    <header className="border-b border-navy-100 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Wordmark href="/dashboard" ariaLabel="facture.gn — Accueil" />
        <PrimaryNav tabs={tabs} />
        <OrgSwitcher organizations={organizations} active={active} />
      </div>
    </header>
  );
}
