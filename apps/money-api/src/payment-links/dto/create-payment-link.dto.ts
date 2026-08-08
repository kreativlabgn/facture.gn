import { z } from "zod";

export const createPaymentLinkSchema = z.object({
  invoiceId: z.string().uuid(),
  organizationId: z.string().uuid(),
  amountGnf: z.coerce.bigint().positive(),
});

export type CreatePaymentLinkDto = z.infer<typeof createPaymentLinkSchema>;
