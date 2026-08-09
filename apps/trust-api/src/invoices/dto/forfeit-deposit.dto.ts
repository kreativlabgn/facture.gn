import { z } from "zod";

// ADR-034 : le staff choisit le motif exact (aucune détection automatique possible,
// voir InvoicesService.forfeitDeposit) — les deux seules valeurs InvoiceEventType
// pertinentes à ce déclenchement, jamais une chaîne libre.
export const forfeitDepositSchema = z.object({
  reason: z.enum(["cancellation_indemnity", "no_show_forfeited"]),
});

export type ForfeitDepositDto = z.infer<typeof forfeitDepositSchema>;
