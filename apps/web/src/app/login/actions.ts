"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login, TrustApiError } from "@/lib/trust-api";
import { scenarioDemoPour } from "@/lib/demo-accounts";
import { normaliserMsisdnGn } from "@/lib/phone-gn";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/session";
import { destinationInterne } from "@/lib/route-protection";

/** « demo » n'est jamais seul : c'est le complément d'un « error », la porte de
 *  sortie offerte à quelqu'un dont la connexion vient d'échouer parce qu'il
 *  cherchait en réalité un écran de démonstration. */
export type LoginActionState =
  | { error: string; demo?: { href: string; libelle: string } }
  | null;


// Server Action plutôt qu'un Route Handler consommé par fetch côté client —
// cohérent avec le choix déjà pris pour les mutations (jamais de secret ni de
// token exposé à du JS navigateur), et fonctionne même sans JS (progressive
// enhancement natif d'un <form action={...}>).
export async function loginAction(_prevState: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const saisie = String(formData.get("msisdn") ?? "");
  const password = String(formData.get("password") ?? "");
  const returnTo = destinationInterne(String(formData.get("returnTo") ?? ""));

  // trust-api n'accepte que la forme canonique (+224XXXXXXXX). Quelqu'un qui
  // tape son numéro comme il le dit — « 622 00 11 22 » — recevait jusqu'ici un
  // refus de format présenté comme un refus d'identifiants. On normalise donc
  // avant l'appel, et on retombe sur la saisie brute quand elle n'est pas
  // normalisable : c'est alors au serveur de dire ce qui ne va pas, pas à cette
  // fonction d'inventer un numéro que personne n'a tapé.
  const msisdn = normaliserMsisdnGn(saisie) ?? saisie;

  let accessToken: string;
  try {
    const result = await login(msisdn, password);
    accessToken = result.accessToken;
  } catch (error) {
    // La vraie connexion est TOUJOURS tentée en premier, y compris sur un
    // numéro qui ressemble à celui d'un scénario : « 622001122 » est un numéro
    // guinéen plausible, et un vrai client peut le porter. Court-circuiter
    // avant l'appel enfermerait ce client dehors de son propre compte.
    const message =
      error instanceof TrustApiError ? error.message : "Connexion temporairement indisponible";

    // Sans ce renvoi, quelqu'un qui recopie un identifiant de démonstration lu
    // sur une capture d'écran obtient « Connexion temporairement indisponible »
    // et en conclut que la plateforme est en panne. Elle ne l'est pas : il
    // frappe à une porte qui n'existe pas, à deux pas de l'écran qu'il
    // cherchait. Le message reste celui de l'API — on ne fait qu'AJOUTER la
    // sortie, jamais masquer la cause.
    const scenario = scenarioDemoPour(msisdn);
    if (scenario) {
      return {
        error: message + " — la même démonstration s'ouvre aussi sans compte.",
        demo: { href: scenario.href, libelle: scenario.libelle },
      };
    }

    return { error: message };
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
  redirect(returnTo);
}