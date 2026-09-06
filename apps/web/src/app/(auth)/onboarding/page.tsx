import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { requireSessionToken } from "@/lib/session";
import { TrustApiError, listMyOrganizations, listMyPractices } from "@/lib/trust-api";
import { OnboardingForm } from "./OnboardingForm";

export const metadata: Metadata = { title: "Configurer votre organisation — facture.gn" };

export default async function OnboardingPage() {
  const token = await requireSessionToken();
  const [organizations, practices] = await Promise.all([
    listMyOrganizations(token),
    // Même arbitrage que la coquille (app)/layout.tsx : l'échappatoire vers
    // l'espace cabinet est un confort de navigation. Si l'appel échoue, on
    // affiche l'écran sans le lien plutôt que de bloquer la création d'une
    // organisation pour un lien secondaire.
    listMyPractices(token).catch((error: unknown) => {
      if (error instanceof TrustApiError) {
        return [];
      }
      throw error;
    }),
  ]);

  // Cet écran ne sert qu'à la PREMIÈRE organisation. Avec une organisation
  // existante, y rester laisserait croire qu'on peut en créer une seconde ici,
  // alors que la coquille a son propre chemin pour ça.
  if (organizations.length > 0) {
    redirect("/dashboard");
  }

  return (
    <AuthCard
      title="Votre organisation"
      description="Dernière étape avant d'émettre votre première facture. Le régime fiscal détermine la TVA appliquée — il n'est jamais choisi à votre place."
      footer={
        practices.length > 0 ? (
          <>
            Vous gérez un cabinet ou un CGA ?{" "}
            <Link href="/cabinet" className="font-semibold text-navy-950 underline underline-offset-2">
              Accéder à votre espace professionnel
            </Link>
          </>
        ) : null
      }
    >
      <OnboardingForm />
    </AuthCard>
  );
}
