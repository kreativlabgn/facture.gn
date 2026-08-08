import { z } from "zod";

const invoiceLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.coerce.bigint().positive(),
  taxRateBps: z.number().int().min(0).optional(),
});

export const createInvoiceSchema = z.object({
  organizationId: z.string().uuid(),
  documentType: z.enum(["invoice", "proforma", "quote"]).default("invoice"),
  lines: z.array(invoiceLineSchema).min(1),
});

export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;
