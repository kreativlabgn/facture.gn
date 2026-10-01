import { getPortalToken } from "@/lib/portal-session";
import { Wordmark } from "@/components/Wordmark";
import { PortalTabs } from "./PortalTabs";

// Coquille du portail acheteur. Distincte de celle du marchand — `(app)` — et
// pour de bonnes raisons : l'acheteur n'a ni organisation active, ni rôle, ni
// permissions. Il a un numéro vérifié, et c'est tout. Lui servir l'OrgSwitcher
// ou les onglets marchands n'aurait aucun sens.
//
// Les onglets n'apparaissent qu'une fois la session ouverte : les montrer à un
// visiteur qui n'a pas encore validé son code promettrait des écrans qui le
// renverraient tous au tunnel.
//
// pb-24 réserve la place de la barre basse sur téléphone, sans quoi la dernière
// ligne de chaque liste passe dessous et devient intouchable.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const token = await getPortalToken();

  // Sans session, ce layout ne pose plus son propre chrome. Les trois autres
  // routes de ce groupe (page.tsx, factures/page.tsx, profil/page.tsx) font
  // `redirect("/portail/auth")` dès que le token est absent — `redirect()`
  // interrompt le rendu avant que ce parent ne s'affiche, donc cette branche
  // ne les concerne JAMAIS. SEULE [invoiceId]/page.tsx rend du contenu sans
  // token (pour garder l'URL de la facture reçue par SMS) : elle pose alors
  // AuthLayout, qui a déjà son propre en-tête et mot-symbole. Garder le
  // chrome ci-dessous actif ici doublerait cet en-tête.
  if (!token) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-full flex-col bg-grey">
      <header className="border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Wordmark href="/portail" ariaLabel="facture.gn — Portail acheteur" />
          <p className="text-xs text-navy-600">Portail acheteur</p>
        </div>
        <div className="hidden border-t border-navy-50 md:block">
          <PortalTabs mode="inline" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 pb-24 sm:px-6 md:pb-10">{children}</main>

      <div className="md:hidden">
        <PortalTabs mode="bar" />
      </div>
    </div>
  );
}
