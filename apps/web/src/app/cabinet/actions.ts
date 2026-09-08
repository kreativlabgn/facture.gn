"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_PRACTICE_COOKIE } from "@/lib/active-practice";
import { SESSION_MAX_AGE_SECONDS, requireSessionToken } from "@/lib/session";
import { listMyPractices } from "@/lib/trust-api";

// Bascule de cabinet actif. Jumelle de switchOrganizationAction, à la
// virgule près — et pour la même raison : un <form action={...}> change de
// contexte sans une ligne de JavaScript, et aucun token n'atteint le
// navigateur.
//
// Le cookie ne porte AUCUNE autorisation : il est reconfronté à la liste
// réelle des cabinets du porteur du JWT à chaque lecture (voir
// pickActivePractice). La validation ci-dessous n'est donc pas un garde de
// sécurité — c'est de l'hygiène : on refuse d'écrire une valeur qui serait
// ignorée à la relecture, plutôt que de laisser croire que le choix a été pris
// en compte.
export async function switchPracticeAction(formData: FormData): Promise<void> {
  const practiceId = String(formData.get("practiceId") ?? "");
  const token = await requireSessionToken();
  const practices = await listMyPractices(token);

  if (practices.some((practice) => practice.id === practiceId)) {
    const store = await cookies();
    store.set(ACTIVE_PRACTICE_COOKIE, practiceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      // Même durée que la session. Un cookie de préférence qui survivrait au
      // JWT rouvrirait l'application sur le cabinet choisi lors d'une session
      // précédente — éventuellement par quelqu'un d'autre.
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
    });
  }

  // Hors du bloc conditionnel : retenu ou non, on repart de l'accueil du
  // cabinet. Rester sur l'écran courant afficherait un instant les données
  // d'un cabinet sous le nom d'un autre.
  redirect("/cabinet");
}
