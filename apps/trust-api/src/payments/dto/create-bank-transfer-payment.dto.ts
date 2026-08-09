import { z } from "zod";

// Aucun champ de preuve (contrairement au cash, C1) : le relevé bancaire de
// l'organisation est déjà la preuve du virement — "rapprochement asynchrone"
// (ADR-052) décrit une vérification humaine différée, pas une brique technique
// à construire ici.
export const createBankTransferPaymentSchema = z.object({
  amount: z.coerce.bigint().positive(),
});

export type CreateBankTransferPaymentDto = z.infer<typeof createBankTransferPaymentSchema>;
