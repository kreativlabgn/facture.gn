import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { getSessionToken } from "@/lib/session";
import { RegisterForm } from "./RegisterForm";

export const metadata: Metadata = { title: "Créer un compte — facture.gn" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  // Un utilisateur déjà connecté qui soumettrait ce formulaire créerait un
  // second compte sur un autre numéro sans qu'aucun écran ne le lui dise.
  if (await getSessionToken()) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const candidate = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const returnTo = candidate?.startsWith("/") && !candidate.startsWith("//") ? candidate : undefined;

  return (
    <AuthCard
      title="Créer mon compte"
      description="Aucune information fiscale n'est requise pour commencer à facturer : le NIF et le numéro eTax restent optionnels (ADR-035)."
      footer={
        <>
          Vous avez déjà un compte ?{" "}
          <Link href="/login" className="font-semibold text-navy-950 underline underline-offset-2">
            Se connecter
          </Link>
        </>
      }
    >
      <RegisterForm returnTo={returnTo} />
    </AuthCard>
  );
}
