import { z } from "zod";

// Quality Audit 2026-08-23, finding #6 — même précédent que
// listReceivedInvoicesQuerySchema (organizationId vient du path param
// :id, jamais dupliqué en query). z.coerce nécessaire : les query params
// HTTP arrivent toujours en string.
export const listMarginLinesQuerySchema = z.object({
  take: z.coerce.number().int().positive().optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

export type ListMarginLinesQueryDto = z.infer<typeof listMarginLinesQuerySchema>;
