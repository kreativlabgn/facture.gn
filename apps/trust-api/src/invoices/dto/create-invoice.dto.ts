import { z } from "zod";

// taxRateBps n'est plus un champ client (C4) — le taux de TVA est dérivé
// exclusivement de organization.regimeFiscal côté serveur (resolveTaxRateBps),
// jamais une valeur de confiance externe (ADR-033).
const invoiceLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.coerce.bigint().positive(),
});

export const createInvoiceSchema = z.object({
  organizationId: z.string().uuid(),
  documentType: z.enum(["invoice", "proforma", "quote"]).default("invoice"),
  lines: z.array(invoiceLineSchema).min(1),
  // Remise globale en pourcentage (E2) — défaut 0, cohérent avec le défaut DB
  // (Invoice.discountPct @default(0)), jamais un défaut serveur différent.
  discountPct: z.number().int().min(0).max(100).default(0),
});

export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;
