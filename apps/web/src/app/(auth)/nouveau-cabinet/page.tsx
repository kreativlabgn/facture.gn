import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { requireSessionToken } from "@/lib/session";
import { listMyPractices } from "@/lib/trust-api";
import { PracticeForm } from "./PracticeForm";

export const metadata: Metadata = { title: "Créer votre cabinet — facture.gn" };

// Création d'une structure professionnelle. POST /practices existait depuis F8
// sans aucun écran pour l'appeler : /cabinet affichait « Aucun cabinet » et
// s'arrêtait là, sans issue.
//
// HORS DE /cabinet, à dessein : le layout de cet espace rend précisément cet
// écran vide quand l'utilisateur n'a pas de cabinet, donc une route
// /cabinet/nouveau afficherait « Aucun cabinet » au lieu du formulaire. Elle
// vit donc dans le groupe `(auth)`, aux côtés de l'onboarding PME dont elle
// est le pendant — même carte, même tunnel.
export default async function NouveauCabinetPage() {
  const token = await requireSessionToken();
  const practices = await listMyPractices(token);

  // Comme l'onboarding PME : cet écran ne sert qu'à la PREMIÈRE structure. Y
  // rester avec un cabinet existant laisserait croire qu'on peut en créer une
  // seconde ici, alors que rien dans la coquille ne le prévoit.
  if (practices.length > 0) {
    redirect("/cabinet");
  }

  return (
    <AuthCard
      title="Votre cabinet"
      description="Créez la structure depuis laquelle vous suivrez vos clients. Vous en devenez l'administrateur, et vous pourrez ensuite inviter vos collaborateurs."
      footer={
        <>
          Vous cherchiez plutôt à gérer votre propre entreprise ?{" "}
          <Link href="/dashboard" className="font-semibold text-navy-950 underline underline-offset-2">
            Aller à votre espace
          </Link>
        </>
      }
    >
      <PracticeForm />
    </AuthCard>
  );
}
