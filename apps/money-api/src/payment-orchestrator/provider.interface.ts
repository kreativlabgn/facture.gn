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

  // OPTIONNELLE, et c'est un choix : tous les providers ne savent pas pousser
  // un débit sur un numéro. La rendre obligatoire forcerait un « throw non
  // supporté » dans chaque implémentation qui ne le fait pas — une capacité
  // absente déguisée en panne. Absente, elle se teste (`if
  // (!provider.chargeMobileMoney)`) et se refuse en amont, avant tout débit.
  chargeMobileMoney?(request: ChargeMobileMoneyRequest): Promise<ChargeMobileMoneyResult>;
}

// ── Débit Mobile Money poussé (Chantier 3) ──────────────────────────────────
//
// `createPaymentLink` rend une URL vers laquelle on REDIRIGE le payeur : c'est
// lui qui, chez le provider, saisit son numéro et confirme. Le débit poussé est
// l'autre sens — facture.gn tient le numéro et demande au provider d'envoyer la
// sollicitation (USSD/push) sur le téléphone du porteur. Les deux coexistent :
// le lien reste le chemin de repli quand le provider ne sait pas pousser.
export type MobileMoneyOperator = "orange_money" | "mtn_momo";

export interface ChargeMobileMoneyRequest {
  invoiceId: string;
  /** Format canonique +224XXXXXXXXX — normalisé par l'appelant, jamais brut. */
  msisdn: string;
  operator: MobileMoneyOperator;
  /** Marchandise + commission facture.gn, hors frais gateway — même convention
   *  que CreatePaymentLinkRequest.amountGnf, et pour la même raison : le
   *  gateway calcule SES frais sur ce montant-là. */
  amountGnf: bigint;
  // invoiceId + ':charge:' + msisdn (ADR-073) — deux clics sur le même bouton
  // ne doivent jamais produire deux débits.
  idempotencyKey: string;
}

export interface ChargeMobileMoneyResult {
  providerRef: string;
  /** `pending` est le cas NOMINAL, pas une anomalie : le débit attend que le
   *  porteur compose son code sur son téléphone. La confirmation arrive plus
   *  tard, par webhook — jamais dans cette réponse. Un écran qui afficherait
   *  « payé » ici mentirait sur une transaction encore en suspens. */
  status: "pending" | "failed";
  feeGatewayGnf: bigint;
  /** Ce que l'écran doit dire au payeur pour qu'il regarde son téléphone. */
  instruction: string;
}