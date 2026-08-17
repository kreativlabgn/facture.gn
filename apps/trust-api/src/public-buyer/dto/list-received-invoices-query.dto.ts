import { z } from "zod";

// z.coerce nécessaire : les query params HTTP arrivent toujours en string
// (même précédent que organizationScopedListQuerySchema).
export const listReceivedInvoicesQuerySchema = z.object({
  take: z.coerce.number().int().positive().optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

export type ListReceivedInvoicesQueryDto = z.infer<typeof listReceivedInvoicesQuerySchema>;
