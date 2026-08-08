import type { PaymentProviderName } from "@facture-gn/db";

export interface CreatePaymentLinkRequest {
  invoiceId: string;
  organizationId: string;
  amountGnf: bigint;
  // invoiceId + ':' + provider (ADR-073) — construit par le registry, jamais par
  // l'appelant, pour garantir l'unicité par (facture, provider tenté).
  idempotencyKey: string;
}

export interface CreatePaymentLinkResult {
  provider: PaymentProviderName;
  providerRef: string;
  paymentLinkUrl: string;
  feeGatewayGnf: bigint;
  expiresAt: Date;
}

export interface VerifyTransactionResult {
  status: "pending" | "success" | "failed";
  providerRef: string;
  settledAt?: Date;
}

export interface NormalizedWebhookResult {
  providerRef: string;
  status: "paid" | "failed" | "pending";
  signatureValid: boolean;
}

// ADR-073 — interface commune aux 4 providers cibles (djomy/moneroo/orange_direct/
// mtn_direct). Objectif explicite : no vendor lock-in.
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createPaymentLink(request: CreatePaymentLinkRequest): Promise<CreatePaymentLinkResult>;
  verifyTransaction(providerRef: string): Promise<VerifyTransactionResult>;
  handleWebhook(rawPayload: unknown): NormalizedWebhookResult;
}
