import { z } from "zod";

// Recherche d'une organisation cliente par NIF, pour le rattachement d'un
// mandat (Chantier C). Le formulaire du cabinet demandait jusqu'ici l'UUID de
// l'organisation — qu'aucun comptable ne connaît.
//
// Aucun format de NIF n'est imposé ici, volontairement : `Organization.nif` est
// un `String?` libre côté schéma, et exiger « 9 chiffres » rendrait
// introuvables les organisations déjà enregistrées avec une autre forme. Les
// bornes ne sont qu'un garde-fou de saisie — la vraie protection contre
// l'énumération est ailleurs (correspondance EXACTE sur une colonne @unique,
// jamais un LIKE, plus le throttle de la route).
export const lookupOrganizationSchema = z.object({
  nif: z
    .string()
    .trim()
    .min(4, "NIF trop court")
    .max(32, "NIF trop long"),
});

export type LookupOrganizationDto = z.infer<typeof lookupOrganizationSchema>;
