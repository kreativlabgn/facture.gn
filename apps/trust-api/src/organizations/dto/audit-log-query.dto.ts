import { z } from "zod";

// "permission" n'est pas une valeur acceptée — aucun historique de changement de
// rôle n'existe encore (G4, voir PLAN). La demander est un 400, jamais une liste
// vide qui masquerait silencieusement ce trou.
export const auditLogQuerySchema = z.object({
  category: z.enum(["facture", "paiement"]).optional(),
  take: z.coerce.number().int().positive().optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

export type AuditLogQueryDto = z.infer<typeof auditLogQuerySchema>;
