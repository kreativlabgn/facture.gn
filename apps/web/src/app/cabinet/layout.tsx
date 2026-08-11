import { requireSessionToken } from "@/lib/session";
import { listMyPractices } from "@/lib/trust-api";
import { Wordmark } from "@/components/Wordmark";

const PRACTICE_TYPE_LABELS: Record<string, string> = {
  cabinet_comptable: "Cabinet comptable",
  gestionnaire: "Gestionnaire",
  fiduciaire: "Fiduciaire",
  cga: "CGA",
};

// Route de premier niveau distincte de /dashboard — un membre de cabinet n'a
// pas nécessairement sa propre organisation PME (PracticeMember est un
// concept d'appartenance entièrement séparé d'OrganizationMember, voir
// schema.prisma). Prend la PREMIÈRE practice du user connecté — aucun
// sélecteur multi-cabinet construit dans cette passe, même scope réduit
// assumé que dashboard/layout.tsx pour les organisations.
export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  const token = await requireSessionToken();
  const practices = await listMyPractices(token);
  const practice = practices[0] ?? null;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Wordmark href="/cabinet" ariaLabel="facture.gn — Accueil cabinet" />
          {practice ? (
            <span className="text-sm text-navy-600">
              <span className="font-semibold text-navy-950">{practice.name}</span>
              <span className="ml-2 font-mono text-xs uppercase text-navy-400">
                {PRACTICE_TYPE_LABELS[practice.type] ?? practice.type} · {practice.role}
              </span>
            </span>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        {practice ? (
          children
        ) : (
          <div className="rounded-2xl border border-navy-100 bg-white p-8 text-center">
            <p className="font-display text-lg font-bold text-navy-950">Aucun cabinet</p>
            <p className="mx-auto mt-3 max-w-sm text-sm text-navy-600">
              Votre compte n&apos;est rattaché à aucun cabinet comptable, gestionnaire, fiduciaire ou CGA.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
