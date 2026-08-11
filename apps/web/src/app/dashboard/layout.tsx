import Link from "next/link";
import { requireSessionToken } from "@/lib/session";
import { listMyOrganizations } from "@/lib/trust-api";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Accueil" },
  { href: "/dashboard/invoices/new", label: "Émettre" },
  { href: "/dashboard/customers", label: "Clients" },
  { href: "/dashboard/settings", label: "Paramètres" },
];

// Prend la PREMIÈRE organisation du user connecté — aucun sélecteur
// multi-organisation construit dans cette passe (scope réduit assumé, voir
// blueprint dashboard) : un user avec plusieurs organisations (cabinet/CGA)
// verra toujours la même jusqu'à ce qu'un switcher soit construit.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const token = await requireSessionToken();
  const organizations = await listMyOrganizations(token);
  const organization = organizations[0] ?? null;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/dashboard" className="flex items-baseline font-display text-xl font-extrabold tracking-tight text-navy-950" aria-label="facture.gn — Accueil">
            facture
            <span aria-hidden="true" className="mx-[2px] mb-[3px] inline-block h-[7px] w-[7px] rounded-full bg-yellow" />
            gn
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 font-medium text-navy-600 transition hover:bg-navy-50 hover:text-navy-950"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {organization ? (
            <span className="text-sm text-navy-600">
              <span className="font-semibold text-navy-950">{organization.name}</span>
              <span className="ml-2 font-mono text-xs uppercase text-navy-400">{organization.role}</span>
            </span>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        {organization ? (
          children
        ) : (
          <div className="rounded-2xl border border-navy-100 bg-white p-8 text-center">
            <p className="font-display text-lg font-bold text-navy-950">Aucune organisation</p>
            <p className="mx-auto mt-3 max-w-sm text-sm text-navy-600">
              Votre compte n&apos;est rattaché à aucune organisation pour le moment.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
