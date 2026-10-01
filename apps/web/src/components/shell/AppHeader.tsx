import type { OrganizationSummary } from "@/lib/trust-api";
import { Wordmark } from "@/components/Wordmark";
import { OrgSwitcher } from "./OrgSwitcher";

// En-tête de la coquille : marque et organisation active. Il ne porte plus de
// navigation. Sur téléphone la navigation principale est en bas, sous le pouce
// (BottomTabBar, `md:hidden`) ; à partir de `md` elle vit dans la barre
// latérale (SidebarNavigation, `hidden md:flex`), qui héberge aussi les
// entrées du tiroir « Plus », l'espace cabinet et la déconnexion. Jamais les
// deux à l'écran, jamais aucune des deux — et un seul repère « Navigation
// principale » exposé au lecteur d'écran à un instant donné.
export function AppHeader({
  organizations,
  active,
}: {
  organizations: readonly OrganizationSummary[];
  active: OrganizationSummary;
}) {
  return (
    <header className="border-b border-navy-100 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Wordmark href="/dashboard" ariaLabel="facture.gn — Accueil" />
        <OrgSwitcher organizations={organizations} active={active} />
      </div>
    </header>
  );
}
