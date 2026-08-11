import type { Metadata } from "next";
import Link from "next/link";
import { requireSessionToken } from "@/lib/session";
import { getOrganization, listMyOrganizations, TrustApiError } from "@/lib/trust-api";

export const metadata: Metadata = { title: "Paramètres — facture.gn" };

const REGIME_LABELS: Record<string, string> = {
  normal_tva: "Normal TVA",
  tpu: "TPU",
  normal_sans_tva: "Normal sans TVA",
  non_assujetti_association: "Non assujetti (association)",
};

export default async function SettingsPage() {
  const token = await requireSessionToken();
  const organizations = await listMyOrganizations(token);
  const organization = organizations[0];
  if (!organization) {
    return null;
  }

  // GET /organizations/:id est réservé owner/admin (même sensibilité que
  // trust-score) — un rôle plus restreint (cashier, accountant_internal) ne
  // doit pas voir une erreur brute, seulement un message clair.
  let detail;
  try {
    detail = await getOrganization(token, organization.id);
  } catch (error) {
    if (error instanceof TrustApiError && error.status === 403) {
      return (
        <div className="rounded-2xl border border-navy-100 bg-white p-8 text-center">
          <p className="font-display text-lg font-bold text-navy-950">Accès réservé</p>
          <p className="mx-auto mt-3 max-w-sm text-sm text-navy-600">
            Seuls les propriétaires et administrateurs de l&apos;organisation peuvent consulter les paramètres.
          </p>
        </div>
      );
    }
    throw error;
  }

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-navy-950">Paramètres</h1>

      <div className="mb-6 rounded-2xl border border-navy-100 bg-white p-5">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nom">{detail.name}</Field>
          <Field label="Régime fiscal">{REGIME_LABELS[detail.regimeFiscal] ?? detail.regimeFiscal}</Field>
          <Field label="NIF">{detail.nif ?? "Non renseigné"}</Field>
          <Field label="RCCM">{detail.rccm ?? "Non renseigné"}</Field>
          <Field label="Palier">{detail.commercialTier}</Field>
          <Field label="Vérification DGI">{detail.dgiVerificationStatus === "verified" ? "Vérifiée" : "Non vérifiée"}</Field>
        </dl>
      </div>

      <div className="rounded-2xl border border-navy-100 bg-white p-5">
        <p className="mb-2 font-display text-sm font-semibold text-navy-950">Export FEC</p>
        <p className="mb-4 text-sm text-navy-600">Fichier des écritures comptables (OHADA/SYSCOHADA).</p>
        <Link
          href="/dashboard/settings/fec"
          className="inline-block rounded-[10px] bg-navy-950 px-6 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-navy-800"
        >
          Télécharger le FEC
        </Link>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-navy-600 uppercase">{label}</dt>
      <dd className="mt-1 text-navy-950">{children}</dd>
    </div>
  );
}
