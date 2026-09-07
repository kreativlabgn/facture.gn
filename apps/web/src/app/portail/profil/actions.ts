"use server";

import { redirect } from "next/navigation";
import { clearPortalToken } from "@/lib/portal-session";

// Fermer la session du portail. Efface UNIQUEMENT `fg_portal` : un acheteur qui
// est aussi commerçant garde sa session marchande (`fg_session`) intacte — ce
// sont deux identités distinctes, portées par deux tokens de portées
// différentes (voir portal-session.ts).
export async function logoutPortalAction(): Promise<void> {
  await clearPortalToken();
  redirect("/portail/auth");
}
