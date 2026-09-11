import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { requireSessionToken } from "@/lib/session";
import { listMyPractices } from "@/lib/trust-api";
import { PracticeForm } from "@/app/(auth)/nouveau-cabinet/PracticeForm";

export const metadata: Metadata = { title: "Espace cabinet — facture.gn" };

// Page d'accueil du canal cabinet, accessible depuis le hub d'inscription.
// Elle remplace l'ancienne page vide : au lieu de laisser un écran blanc, elle
// oriente selon l'état du compte.
export default async function EspaceCabinetPage() {
  const token = await requireSessionToken();
  const practices = await listMyPractices(token);

  // Déjà membre d'un cabinet : on envoie vers la console.
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