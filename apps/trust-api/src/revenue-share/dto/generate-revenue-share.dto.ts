import { z } from "zod";

// H4 — periodMonth optionnel : le mois en cours par défaut si omis (résolu
// côté controller, pas dans le schema — un défaut Zod figerait "aujourd'hui"
// au moment du parsing du module plutôt qu'à la requête).
export const generateRevenueShareSchema = z.object({
  periodMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format attendu : YYYY-MM")
    .optional(),
});

export type GenerateRevenueShareDto = z.infer<typeof generateRevenueShareSchema>;
