"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_PRACTICE_COOKIE } from "@/lib/active-practice";
import { SESSION_MAX_AGE_SECONDS, requireSessionToken } from "@/lib/session";
import { listMyPractices } from "@/lib/trust-api";

// Franchissement DÉLIBÉRÉ du seuil entre l'espace marchand et un cabinet.
//
// C'est une Server Action derrière un <form>, donc un POST — jamais un <Link>.
// La différence n'est pas cosmétique : un lien change d'entité juridique au
// survol d'un doigt, une soumission demande un geste. C'est tout l'objet de cet
// écran.
export async function entrerDansCabinetAction(formData: FormData): Promise<void> {
  const practiceId = String(formData.get("practiceId") ?? "");
  const token = await requireSessionToken();
  const practices = await listMyPractices(token);

  // Le cookie n'autorise RIEN — il est reconfronté à la liste réelle du porteur
  // du JWT à chaque lecture (pickActivePractice), et trust-api refuse de toute
  // façon tout non-membre en 403. Ce contrôle-ci évite seulement d'écrire une
  // valeur qui serait ignorée à la relecture.
  if (!practices.some((practice) => practice.id === practiceId)) {
    // On ne dit pas « ce cabinet n'existe pas » : on renvoie au seuil, qui
    // n'affiche que les cabinets réels du compte.
    redirect("/dashboard/espace-cabinet");
  }

  const store = await cookies();
  store.set(ACTIVE_PRACTICE_COOKIE, practiceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });

  redirect("/cabinet");
}
