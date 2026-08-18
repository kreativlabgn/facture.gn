import { z } from "zod";

// E10 — cost_price/taxExemptionCategory volontairement absents : territoire
// d'E6 (coût d'achat), jamais renseignés par ce DTO minimal (voir PLAN
// "Clarifications" — prérequis construit ici, pas une story de catalogue).
export const createProductSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
});

export type CreateProductDto = z.infer<typeof createProductSchema>;
