import { redirect } from "next/navigation";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { canEmit, visibleMoreEntries, visibleTabs } from "@/lib/nav";
import { requireSessionToken } from "@/lib/session";
import { TrustApiError, listMyPractices } from "@/lib/trust-api";
import { AppHeader } from "@/components/shell/AppHeader";
import { BottomTabBar } from "@/components/shell/BottomTabBar";
import { NavGate } from "@/components/shell/NavGate";
import { SidebarNavigation } from "@/components/shell/SidebarNavigation";

// Coquille de l'espace connecté (ADR-095). Groupe de routes `(app)` : les
// parenthèses ne changent aucune URL — /dashboard reste /dashboard — elles
// donnent seulement un layout commun à tout ce que la coquille habille. Les
// liens existants, le proxy et les Server Actions ne bougent pas.
//
// /cabinet reste hors du groupe : c'est une autre persona (PracticeMember,
// concept d'appartenance séparé d'OrganizationMember) avec sa propre
// navigation. La coquille d'onglets décrite par ADR-095 est celle de
// l'organisation ; la plaquer sur le cabinet demanderait une notion de « mode »
// que l'ADR ne décrit pas. Le tiroir « Plus » y mène quand l'utilisateur a
// effectivement un cabinet.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = await requireSessionToken();
  const [{ organizations, active }, practices] = await Promise.all([
    resolveActiveOrganization(token),
    // L'entrée « Espace cabinet » du tiroir est un confort de navigation, pas
    // une donnée de l'écran. Si l'appel échoue, on affiche la coquille sans
    // cette entrée plutôt que de faire tomber toute la facturation pour un
    // lien secondaire. L'erreur n'est pas masquée pour autant : /cabinet
    // reste accessible à l'URL et affichera, lui, la vraie erreur.
    listMyPractices(token).catch((error: unknown) => {
      if (error instanceof TrustApiError) {
        return [];
      }
      throw error;
    }),
  ]);

  // Un compte sans organisation ne peut rien faire de la coquille : ni onglet,
  // ni émission, ni liste. L'état vide affiché ici était une impasse — on
  // envoie désormais vers le tunnel qui la crée. /onboarding renvoie de
  // lui-même vers /dashboard dès qu'une organisation existe : les deux
  // redirections ne peuvent donc pas se renvoyer la balle.
  if (!active) {
    redirect("/onboarding");
  }

  const role = active.role;
  const tabs = visibleTabs(role);
  const moreEntries = visibleMoreEntries(role);
  const cabinetHref = practices.length > 0 ? "/dashboard/espace-cabinet" : null;

  // Deux dispositions pour une seule coquille. Sous `md` : flux normal, la
  // page défile avec le document et la barre basse est fixée. À partir de
  // `md` : la coquille prend exactement la hauteur de la fenêtre (h-dvh), la
  // barre latérale et l'en-tête restent en place, et SEULE la zone de travail
  // défile (min-h-0 + overflow-y-auto) — sans min-h-0, un enfant flex refuse de
  // descendre sous la hauteur de son contenu et rien ne défile.
  return (
    <div className="flex min-h-full bg-white md:h-dvh">
      <SidebarNavigation tabs={tabs} moreEntries={moreEntries} cabinetHref={cabinetHref} active={active} />

      <div className="flex min-w-0 flex-1 flex-col md:min-h-0">
        <AppHeader organizations={organizations} active={active} />

        {/* pb-24 laisse la place à la barre basse : sans lui, la dernière ligne
            de chaque liste passe sous les onglets et devient intouchable. Le
            gabarit centré est DANS <main> et non sur lui : c'est <main> qui
            défile, et sa barre de défilement doit longer le bord de la fenêtre,
            pas le bord du gabarit. */}
        <main className="flex-1 md:min-h-0 md:overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-24 sm:px-6 md:pb-10">
            <NavGate role={role}>{children}</NavGate>
          </div>
        </main>

        <BottomTabBar
          tabs={tabs}
          moreEntries={moreEntries}
          canEmit={canEmit(role)}
          cabinetHref={cabinetHref}
          role={role}
        />
      </div>
    </div>
  );
}
