"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login, TrustApiError } from "@/lib/trust-api";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

export type LoginActionState = { error: string } | null;

// Server Action plutôt qu'un Route Handler consommé par fetch côté client —
// cohérent avec le choix déjà pris pour les mutations (jamais de secret ni de
// token exposé à du JS navigateur), et fonctionne même sans JS (progressive
// enhancement natif d'un <form action={...}>).
export async function loginAction(_prevState: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const msisdn = String(formData.get("msisdn") ?? "");
  const password = String(formData.get("password") ?? "");

  let accessToken: string;
  try {
    const result = await login(msisdn, password);
    accessToken = result.accessToken;
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Connexion temporairement indisponible" };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });

  // Hors du try/catch : redirect() lève une erreur interne Next.js dédiée,
  // qui serait sinon interceptée par le catch ci-dessus comme un échec de login.
  redirect("/dashboard");
}
