import { z } from "zod";
import { CASH_PROOF_THRESHOLD_GNF_CENTIMES } from "./create-payment.dto";

// Arrhes (C5, ADR-034) — toujours cash au MVP, jamais un lien de paiement orchestré
// pour un dépôt (YAGNI, aucun signal produit pour un besoin autre que l'encaissement
// au comptoir). Même seuil de preuve que create-payment.dto.ts (C1) — pas de
// duplication de la valeur, importée directement.
export const recordDepositSchema = z
  .object({
    amount: z.coerce.bigint().positive(),
    proofPhotoUrl: z.string().url().optional(),
    proofGpsLat: z.coerce.number().min(-90).max(90).optional(),
    proofGpsLng: z.coerce.number().min(-180).max(180).optional(),
    proofSignature: z.string().min(1).optional(),
  })
  .refine(
    (data) =>
      data.amount <= CASH_PROOF_THRESHOLD_GNF_CENTIMES ||
      (data.proofPhotoUrl !== undefined &&
        data.proofGpsLat !== undefined &&
        data.proofGpsLng !== undefined &&
        data.proofSignature !== undefined),
    {
      message: "Photo, GPS et signature obligatoires pour un dépôt cash > 1M GNF",
      path: ["proofPhotoUrl"],
    },
  );

export type RecordDepositDto = z.infer<typeof recordDepositSchema>;
