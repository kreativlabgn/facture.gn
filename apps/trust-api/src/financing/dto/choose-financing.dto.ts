import { z } from "zod";

// K4, ADR-088 — Rail B (attente Trésor) n'a pas de DTO : c'est une absence
// d'action (voir PLAN "Clarifications"), jamais un choix à valider ici.
export const chooseFinancingSchema = z.object({
  financialPartnerId: z.string().uuid(),
  disbursementMethod: z.enum(["payment_link_payout", "bank_transfer"]),
});

export type ChooseFinancingDto = z.infer<typeof chooseFinancingSchema>;
