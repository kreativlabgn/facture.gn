import { z } from "zod";
import { invoiceLineSchema } from "../../invoices/dto/create-invoice.dto";

// I1, ADR-056 — jamais de organizationId ici : cette DTO est le corps de
// POST /organizations/:id/recurring-templates, :id (URL) fait foi (même
// pattern que invite-organization-member.dto.ts). Jamais de taux/régime
// fiscal : lines réutilise invoiceLineSchema tel quel (aucune copie séparée).
export const createRecurringTemplateSchema = z.object({
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  lines: z.array(invoiceLineSchema).min(1),
  discountPct: z.number().int().min(0).max(100).default(0),
  intervalDays: z.number().int().positive(),
});

export type CreateRecurringTemplateDto = z.infer<typeof createRecurringTemplateSchema>;
