"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/active-organization";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, requireSessionToken } from "@/lib/session";
import { listMyOrganizations } from "@/lib/trust-api";

// Actions de la coquille — celles qui n'appartiennent à aucun écran en
// particulier. Server Actions plutôt que Route Handlers, comme loginAction :
// aucun token n'atteint jamais du JS navigateur, et un <form action={...}>
// fonctionne sans JavaScript (l'agent terrain sur un téléphone d'entrée de
// gamme n'attend pas que le bundle arrive pour changer d'organisation).

// Le cookie d'organisation active ne porte AUCUNE autorisation : il est
// reconfronté à la liste réelle des organisations du porteur du JWT à chaque
// lecture (voir pickActiveOrganization). La validation ci-dessous n'est donc
// pas un garde de sécurité — c'est de l'hygiène : on refuse d'écrire une
// valeur qui serait ignorée à la relecture, plutôt que de laisser
// l'utilisateur croire que son choix a été pris en compte.
export async function switchOrganizationAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const token = await requireSessionToken();
  const organizations = await listMyOrganizations(token);

  if (organizations.some((organization) => organization.id === organizationId)) {
    const store = await cookies();
    store.set(ACTIVE_ORGANIZATION_COOKIE, organizationId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      // Même durée que la session : un cookie de préférence qui survivrait au
      // JWT ferait rouvrir l'application sur une organisation choisie lors
      // d'une session précédente, éventuellement par quelqu'un d'autre sur un
      // téléphone partagé.
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
    });
  }

  // Hors du bloc conditionnel : que le changement ait été retenu ou non, on
  // repart de l'accueil. Rester sur l'écran courant afficherait les données
  // d'une organisation sous le nom d'une autre le temps d'un rendu.
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
  // L'organisation active part avec la session : sur un téléphone partagé —
  // cas courant dans une PME guinéenne — le compte suivant ne doit pas hériter
  // du choix du précédent, même si ce choix serait de toute façon ignoré.
  store.delete(ACTIVE_ORGANIZATION_COOKIE);
  redirect("/login");
}
