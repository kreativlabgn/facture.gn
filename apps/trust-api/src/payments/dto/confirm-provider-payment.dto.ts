import { z } from "zod";

// Appelé exclusivement par money-api (InternalAuthGuard) après confirmation webhook
// (ADR-075) — jamais par un client final, donc pas de preuve photo/GPS/signature
// (C1) ni de header Idempotency-Key : providerRef sert déjà de clé d'idempotence
// naturelle (unique par tentative, ADR-076).
export const confirmProviderPaymentSchema = z.object({
  amountGnf: z.coerce.bigint().positive(),
  provider: z.enum(["djomy", "moneroo", "orange_direct", "mtn_direct"]),
  providerRef: z.string().min(1),
  feeGatewayGnf: z.coerce.bigint().nonnegative(),
});

export type ConfirmProviderPaymentDto = z.infer<typeof confirmProviderPaymentSchema>;
