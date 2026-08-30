import type { PreferredLanguage } from "@facture-gn/db";

// Langues du texte SORTANT (SMS/WhatsApp). ADR-051 priorise le canal vocal sur
// la traduction du texte USSD (68 % d'analphabétisme) : ce module ne concerne
// donc PAS les menus USSD ni le PDF (document légal, français officiel OHADA).
//
// `PreferredLanguage` (Prisma) a 4 valeurs (fr/pular/malinke/soussou). Seules
// `fr` et `pular` sont branchées ici (roadmap F2, « commencer par fr + pular ») ;
// `malinke`/`soussou` retombent sur `fr` tant qu'aucun catalogue n'existe.
export type Locale = "fr" | "pular";

export function resolveLocale(preferred: PreferredLanguage | null | undefined): Locale {
  return preferred === "pular" ? "pular" : "fr";
}
