import type { Metadata } from "next";
import Link from "next/link";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { requireSessionToken } from "@/lib/session";
import { getOrganization, TrustApiError } from "@/lib/trust-api";
import { Card, EmptyState } from "@/components/ui";
import { OrganizationForm } from "./OrganizationForm";

export const metadata: Metadata = { title: "Fiche de l'organisation — facture.gn" };

// Fiche d'identité légale, en écriture. Elle s'appuie sur PATCH /organizations/:id,
// première route @Patch du service — jusqu'ici tout y était @Get/@Post, et rien
// ne permettait de corriger une organisation après sa création.
//
// Les champs affichés sont ceux qui EXISTENT au schéma. Capital social, pays et
// fuseau horaire n'y figurent pas : les ajouter demande une migration, pas un
// formulaire.
export default async function FicheOrganisationPage() {
  const token = await requireSessionToken();
  const { active } = await resolveActiveOrganization(token);
  if (!active) {
    return null;
  }

  let organization;
  try {
    organization = await getOrganization(token, active.id);
  } catch (error) {
    if (error instanceof TrustApiError && error.status === 403) {
      return (
        <EmptyState
          title="Accès réservé"
          description="Seuls les propriétaires et administrateurs peuvent modifier la fiche de l'organisation."
        />
      );
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-navy-950">Fiche de l&apos;organisation</h1>
          <p className="mt-1 max-w-prose text-sm text-navy-600">
            L&apos;identité légale qui figure sur vos factures certifiées.
          </p>
        </div>
        <Link href="/dashboard/settings" className="text-sm font-medium text-navy-600 hover:text-navy-950">
          ← Paramètres
        </Link>
      </div>

      <Card>
        <div className="p-6">
          <OrganizationForm organization={organization} />
        </div>
      </Card>
    </div>
  );
}
