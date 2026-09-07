import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPortalToken } from "@/lib/portal-session";
import { OtpTunnel } from "../OtpTunnel";

export const metadata: Metadata = { title: "Accéder à mes factures — facture.gn" };

// Entrée autonome du portail, sans facture de départ. C'est la cible de la
// redirection des écrans protégés, et la porte pour qui arrive sans lien SMS.
//
// Une session déjà ouverte n'a rien à faire ici : on renvoie à l'accueil plutôt
// que de redemander un code inutilement — et d'en consommer un par SMS.
export default async function PortailAuthPage() {
  if (await getPortalToken()) {
    redirect("/portail");
  }
  return <OtpTunnel />;
}
