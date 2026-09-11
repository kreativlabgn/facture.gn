import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { getPortalToken } from "@/lib/portal-session";
import { OtpTunnel } from "../OtpTunnel";

export const metadata: Metadata = { title: "Accéder à mes factures — facture.gn" };

// Entrée autonome du portail, sans facture de départ. C'est la cible de la
// redirection des écrans protégés, et la porte pour qui arrive sans lien SMS.
//
// HORS de la coquille du portail (portail/(coquille)/layout.tsx), à dessein :
// cette page n'a ni onglets ni session à montrer, elle a un formulaire et un
// contexte à donner. AuthLayout pose l'écran scindé — les trois étapes, la
// tuile « vos données », le lien vers l'aide — et les sorties « Changer de
// profil » / « Retour à l'accueil » pour qui n'est pas acheteur.
//
// Une session déjà ouverte n'a rien à faire ici : on renvoie à l'accueil plutôt
// que de redemander un code inutilement — et d'en consommer un par SMS.
export default async function PortailAuthPage() {
  if (await getPortalToken()) {
    redirect("/portail");
  }
  return (
    <AuthLayout role="acheteur">
      <OtpTunnel encadre={false} />
    </AuthLayout>
  );
}
