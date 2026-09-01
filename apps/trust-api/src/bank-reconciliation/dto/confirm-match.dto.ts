import { z } from "zod";

// Lot rapprochement bancaire — le staff confirme un couple (transaction, facture).
// transactionId vient de l'URL (@Param), seul invoiceId est dans le corps.
export const confirmMatchSchema = z.object({
  invoiceId: z.string().uuid(),
});

export type ConfirmMatchDto = z.infer<typeof confirmMatchSchema>;
