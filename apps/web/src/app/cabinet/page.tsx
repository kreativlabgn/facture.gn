import type { Metadata } from "next";
import Link from "next/link";
import { requireSessionToken } from "@/lib/session";
import { listAccessibleOrganizations, listMyPractices } from "@/lib/trust-api";

export const metadata: Metadata = { title: "Cabinet — facture.gn" };

const GRANTED_ROLE_LABELS: Record<string, string> = {
  accountant_external: "Comptable externe",
  business_manager: "Gestionnaire",
};

// Écran de référence (maquette "06 Cabinet/CGA") : liste des organisations
// clientes accessibles via un mandat actif — pas de sélecteur multi-cabinet ni
// de "revenue share"/commission dans cette passe (aucun endpoint d'agrégation
// côté trust-api, même discipline que dashboard/page.tsx : pas de données
// inventées plutôt qu'un chiffre fictif).
export default async function CabinetHomePage() {
  const token = await requireSessionToken();
  const practices = await listMyPractices(token);
  const practice = practices[0];
  if (!practice) {
    return null;
  }

  const mandates = await listAccessibleOrganizations(token, practice.id);

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-navy-950">Organisations clientes</h1>

      <div className="rounded-2xl border border-navy-100 bg-white">
        {mandates.length === 0 ? (
          <p className="p-8 text-center text-sm text-navy-600">Aucun mandat actif pour le moment.</p>
        ) : (
          mandates.map((mandate, index) => (
            <div
              key={mandate.id}
              className={`flex items-center justify-between gap-4 px-5 py-4 ${index === mandates.length - 1 ? "" : "border-b border-navy-50"}`}
            >
              <span className="font-semibold text-navy-950">{mandate.organization.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-navy-600">{GRANTED_ROLE_LABELS[mandate.grantedRole] ?? mandate.grantedRole}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-bg px-2.5 py-1 font-mono text-[11px] font-bold text-green-text">
                  ● Actif
                </span>
                <Link
                  href={`/cabinet/organizations/${mandate.organization.id}`}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-navy-600 transition hover:bg-navy-50 hover:text-navy-950"
                >
                  Voir
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
