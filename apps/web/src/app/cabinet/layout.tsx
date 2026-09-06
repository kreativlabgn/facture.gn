import { CabinetShell } from "@/components/shell/CabinetShell";
import { Wordmark } from "@/components/Wordmark";
import { requireSessionToken } from "@/lib/session";
import { listMyPractices } from "@/lib/trust-api";

// Route de premier niveau distincte de /dashboard — un membre de cabinet n'a
// pas nécessairement sa propre organisation PME (PracticeMember est un concept
// d'appartenance entièrement séparé d'OrganizationMember, voir schema.prisma).
//
// Prend la PREMIÈRE practice du user connecté : aucun sélecteur multi-cabinet
// n'est construit dans cette passe, même périmètre réduit qu'avant le
// Chantier C. La navigation, elle, passe désormais par CabinetShell.
export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  const token = await requireSessionToken();
  const practices = await listMyPractices(token);
  const practice = practices[0] ?? null;

  // Sans cabinet, il n'y a rien à naviguer : on rend l'explication seule
  // plutôt qu'une coquille dont chaque entrée mènerait à une page vide.
  if (!practice) {
    return (
      <div className="flex min-h-full flex-col">
        <header className="border-b border-navy-100 bg-white">
          <div className="mx-auto flex max-w-6xl items-center px-4 py-4 sm:px-6">
            <Wordmark href="/cabinet" ariaLabel="facture.gn — Accueil cabinet" />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
          <div className="rounded-2xl border border-navy-100 bg-white p-8 text-center">
            <p className="font-display text-lg font-bold text-navy-950">Aucun cabinet</p>
            <p className="mx-auto mt-3 max-w-sm text-sm text-navy-600">
              Votre compte n&apos;est rattaché à aucun cabinet comptable, gestionnaire, fiduciaire ou CGA.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <CabinetShell practiceName={practice.name} practiceType={practice.type} practiceRole={practice.role}>
      {children}
    </CabinetShell>
  );
}
