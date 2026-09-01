import { z } from "zod";

// Lot rapprochement bancaire — organizationId vient du path param :id (jamais en
// query, même précédent que listMarginLinesQuerySchema). z.coerce : les query
// params HTTP arrivent en string.
export const listBankTransactionsQuerySchema = z.object({
  state: z.enum(["unmatched", "matched", "ignored"]).optional(),
  importBatchId: z.string().uuid().optional(),
  take: z.coerce.number().int().positive().max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

export type ListBankTransactionsQueryDto = z.infer<typeof listBankTransactionsQuerySchema>;
