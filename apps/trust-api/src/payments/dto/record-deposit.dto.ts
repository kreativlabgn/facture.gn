import { z } from "zod";

// Arrhes (C5, ADR-034) — toujours cash au MVP, jamais un lien de paiement orchestré
// pour un dépôt (YAGNI, aucun signal produit pour un besoin autre que l'encaissement
// au comptoir). G3, ADR-091 — même migration que create-payment.dto.ts : la règle de
// seuil vit désormais dans PaymentsService.assertCashProofRequirement().
export const recordDepositSchema = z.object({
  amount: z.coerce.bigint().positive(),
  proofPhotoUrl: z.string().url().optional(),
  proofGpsLat: z.coerce.number().min(-90).max(90).optional(),
  proofGpsLng: z.coerce.number().min(-180).max(180).optional(),
  proofSignature: z.string().min(1).optional(),
});

export type RecordDepositDto = z.infer<typeof recordDepositSchema>;
