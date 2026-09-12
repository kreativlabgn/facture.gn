import type { Metadata } from "next";
import Link from "next/link";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { profilDepuisReturnTo } from "@/lib/auth-contexte";
import { ESPACES } from "@/lib/espaces";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Connexion — facture.gn" };

// Une seule page de connexion pour le marchand et le cabinet — c'est le MÊME
// compte (msisdn + mot de passe), seule la console d'arrivée change. Le profil
// affiché dans la zone d'information est déduit de returnTo : le menu du
// header et la carte cabinet arrivent avec returnTo=/cabinet, tout le reste
// est marchand. L'acheteur n'entre jamais ici : sa porte est /portail/auth.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  const returnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const profil = profilDepuisReturnTo(returnTo);
  const espace = ESPACES.find((e) => e.id === profil)!;

  return (
    <AuthLayout role={profil}>
      <h1 className="font-display text-2xl font-bold text-navy-950">
        {profil === "cabinet" ? "Connexion à votre cabinet" : "Connexion à votre espace"}
      </h1>
      <p className="mt-1 text-sm text-navy-600">Le numéro et le mot de passe de votre compte facture.gn.</p>
      <div className="mt-6">
        <LoginForm returnTo={returnTo} />
      </div>
      {espace.creation ? (
        <p className="mt-6 text-sm text-navy-600">
          Pas encore de compte ?{" "}
          <Link href={espace.creation.href} className="font-semibold text-navy-950 underline underline-offset-2">
            {espace.creation.label}
          </Link>
        </p>
      ) : null}
    </AuthLayout>
  );
}
