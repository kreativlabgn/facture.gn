import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSessionToken } from "@/lib/session";
import { resolveActiveOrganization } from "@/lib/active-organization";

export const metadata: Metadata = { title: "Espace marchand — facture.gn" };

// Page d'accueil du canal marchand, accessible depuis le hub d'inscription.
// Elle remplace l'ancienne route inexistante : au lieu de laisser un 404, elle
// oriente selon l'état de la session.
export default async function EspaceMarchandPage() {
  const token = await requireSessionToken();
  const { active: organization } = await resolveActiveOrganization(token);

  // Déjà une organisation : on envoie vers le tableau de bord.
  if (organization) {
    redirect("/dashboard");
  }

  // Compte créé mais aucune organisation : on envoie vers le tunnel de création.
  redirect("/onboarding");
}