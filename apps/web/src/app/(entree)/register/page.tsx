import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { EtapeIndicateur } from "@/components/auth/EtapeIndicateur";
import { profilDepuisReturnTo } from "@/lib/auth-contexte";
import { ESPACES } from "@/lib/espaces";
import { ETAPES_INSCRIPTION } from "@/lib/etapes-inscription";
import { destinationInterne } from "@/lib/route-protection";
import { getSessionToken } from "@/lib/session";
import { RegisterForm } from "./RegisterForm";

export const metadata: Metadata = { title: "Créer un compte — facture.gn" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  const candidate = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;

  // Un utilisateur déjà connecté a, par définition, déjà le compte que ce
  // formulaire créerait — le soumettre en créerait un second sur un autre
  // numéro, sans qu'aucun écran ne le lui dise, d'où le refus de le rendre.
  // Mais returnTo (ex. /nouveau-cabinet, cf. lib/espaces.ts : marchand et
  // cabinet partagent le même type de compte) reste un tunnel légitime pour
  // qui a déjà un compte — il ne lui manque que la structure suivante.
  // L'ignorer et forcer /dashboard le renvoyait silencieusement à sa
  // boutique marchande au lieu de le laisser créer son cabinet. Même garde
  // anti-open-redirect que registerAction/route-protection.ts.
  if (await getSessionToken()) {
    redirect(destinationInterne(candidate ?? "", "/dashboard"));
  }

  const returnTo = candidate?.startsWith("/") && !candidate.startsWith("//") ? candidate : undefined;

  // Même compte pour le marchand et le cabinet ; le profil ne change que le
  // contexte affiché et la destination après création (returnTo, honoré par
  // registerAction). Hors du groupe (auth) : AuthLayout est une page entière,
  // pas une carte sous le SiteHeader.
  const profil = profilDepuisReturnTo(returnTo);
  const espace = ESPACES.find((e) => e.id === profil)!;

  return (
    <AuthLayout role={profil}>
      <EtapeIndicateur profil={profil} etape="compte" />
      <h1 className="font-display text-2xl font-bold text-navy-950">
        {profil === "cabinet" ? "Inscrire mon cabinet" : "Créer mon compte"}
      </h1>
      <p className="mt-1 text-sm leading-relaxed text-navy-600">
        {profil === "cabinet"
          ? "D'abord votre compte, puis la structure du cabinet à l'étape suivante."
          : "Aucune information fiscale n'est requise pour commencer à facturer : le NIF et le numéro eTax restent optionnels (ADR-035)."}
      </p>
      <p className="mt-1 text-xs text-navy-600">{ETAPES_INSCRIPTION[profil].apercu}</p>
      <div className="mt-6">
        <RegisterForm returnTo={returnTo} />
      </div>
      <p className="mt-6 text-sm text-navy-600">
        Vous avez déjà un compte ?{" "}
        <Link href={espace.connexion.href} className="font-semibold text-navy-950 underline underline-offset-2">
          Se connecter
        </Link>
      </p>
    </AuthLayout>
  );
}
