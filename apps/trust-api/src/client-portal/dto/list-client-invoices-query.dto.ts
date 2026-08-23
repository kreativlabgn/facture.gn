import { z } from "zod";

export const listClientInvoicesQuerySchema = z.object({
  take: z.coerce.number().int().positive().optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

export type ListClientInvoicesQueryDto = z.infer<typeof listClientInvoicesQuerySchema>;
