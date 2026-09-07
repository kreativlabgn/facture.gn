import { z } from "zod";

// Rechargement décidé par facture.gn (console d'administration). Le montant est
// en CENTIMES GNF, comme partout ailleurs dans ce dépôt — jamais des GNF
// « naturels » : la conversion appartient à l'interface qui saisit, pas au
// contrat.
export const grantCreditsSchema = z.object({
  organizationId: z.string().uuid(),
  // Chaîne et non number : un montant en centimes dépasse vite la précision
  // sûre d'un Number, et une somme d'argent ne doit jamais être arrondie en
  // silence. Converti en BigInt côté service.
  amountCentimes: z
    .string()
    .regex(/^[1-9]\d*$/, "montant en centimes, entier strictement positif"),
  // Ce que verra le commerçant sur son relevé. Exigé : un mouvement d'argent
  // sans motif est exactement ce qu'un registre est censé empêcher.
  label: z.string().min(1).max(120),
});

export type GrantCreditsDto = z.infer<typeof grantCreditsSchema>;
