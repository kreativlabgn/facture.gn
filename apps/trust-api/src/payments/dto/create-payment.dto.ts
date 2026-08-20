import { z } from "zod";

// DAT §config : cash_proof_threshold_gnf = 100 000 000 centimes (1M GNF) — seuil
// photo/GPS/signature obligatoire. En dur pour le MVP : CONFIG_PARAMETER (table
// versionnée) n'est pas encore scaffoldé dans ce repo.
export const CASH_PROOF_THRESHOLD_GNF_CENTIMES = 100_000_000n;

// invoiceId vient du paramètre d'URL (POST /invoices/:id/payments), jamais du body —
// nécessaire pour que RolesGuard.resolveOrganizationId() (params.id) résolve
// l'organisation ciblée sans devoir généraliser le guard partagé.
// G3, ADR-091 — la règle "preuve obligatoire au-delà du seuil" a migré vers
// PaymentsService.assertCashProofRequirement() (voir cash-proof-requirement.ts) :
// ce schéma n'a plus accès à l'organisation, nécessaire pour résoudre un
// éventuel seuil abaissé (Niveau 2). Validation de forme uniquement ici.
export const createPaymentSchema = z.object({
  amount: z.coerce.bigint().positive(),
  // bank_transfer (C3) et payment_link (C2, orchestrateur) sont des stories
  // séparées — seul cash est accepté par ce DTO (C1).
  method: z.literal("cash"),
  proofPhotoUrl: z.string().url().optional(),
  proofGpsLat: z.coerce.number().min(-90).max(90).optional(),
  proofGpsLng: z.coerce.number().min(-180).max(180).optional(),
  proofSignature: z.string().min(1).optional(),
});

export type CreatePaymentDto = z.infer<typeof createPaymentSchema>;
