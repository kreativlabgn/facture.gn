import { z } from "zod";

// invoiceId vient du paramètre d'URL (POST /invoices/:id/credit-notes), jamais du
// body — même raison que create-payment.dto.ts : RolesGuard.resolveOrganizationId()
// résout déjà params.id comme une facture, aucun changement de guard nécessaire.
export const createCreditNoteSchema = z.object({
  reason: z.string().min(1),
  // refund_multiplier (ERD, ADR-034/040) — 1 ou 2 (arrhes + annulation
  // professionnelle) ; défaut 1, jamais un multiplicateur implicite ailleurs.
  refundMultiplier: z.union([z.literal(1), z.literal(2)]).default(1),
  // amount n'est jamais un champ du DTO — calculé côté serveur depuis
  // quantityReturned × invoiceLine.unitPrice, jamais une valeur de confiance
  // externe (même principe que taxRateBps, C4).
  lines: z
    .array(
      z.object({
        invoiceLineId: z.string().uuid(),
        quantityReturned: z.number().int().positive(),
      }),
    )
    .min(1),
});

export type CreateCreditNoteDto = z.infer<typeof createCreditNoteSchema>;
