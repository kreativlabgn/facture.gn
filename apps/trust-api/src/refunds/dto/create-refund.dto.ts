import { z } from "zod";

// creditNoteId vient du paramètre d'URL (POST /credit-notes/:id/refunds), jamais du
// body — même raison que create-payment.dto.ts : RolesGuard.resolveOrganizationId()
// résout déjà params.id (@OrganizationIdSource("credit-note")).
export const createRefundSchema = z.object({
  amount: z.coerce.bigint().positive(),
  // payment_link_payout (Djomy Payout, fallback Moneroo) : aucune exécution
  // automatique construite ici (V2, ADR-089) — accepté au niveau du type, créé
  // "pending" côté service.
  method: z.enum(["cash", "payment_link_payout", "bank_transfer", "credit_on_account"]),
});

export type CreateRefundDto = z.infer<typeof createRefundSchema>;
