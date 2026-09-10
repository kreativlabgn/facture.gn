import { logoutAction } from "@/app/(app)/actions";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/ui";

// Route de premier niveau, étanche — au même titre que /cabinet.
//
// Un DAF n'est membre d'AUCUNE organisation PME : ni /dashboard (qui suppose
// une organisation marchande active) ni /cabinet (qui suppose un
// PracticeMember) n'a de sens pour lui. Son appartenance est un
// PublicBuyerAccountMember, un concept entièrement séparé des deux autres.
//
// Aucun lien vers /dashboard ou /cabinet dans cet en-tête : la sortie de cet
// espace est la fermeture de session, jamais un passage latéral vers un espace
// dont l'occupant n'a probablement aucun accès.
export default function DafLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-grey">
      <header className="border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Wordmark href="/daf" ariaLabel="facture.gn — Accueil acheteur public" />
          <form action={logoutAction}>
            <Button type="submit" variant="ghost">
              Fermer la session
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
