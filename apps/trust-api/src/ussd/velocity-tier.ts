import type { DgiVerificationStatus } from "@facture-gn/db";

export type VelocityTier = "T0" | "T1" | "T2" | "T3";

const DAY_MS = 24 * 3600_000;
const T2_DELAY_MS = 90 * DAY_MS; // "T1+90j"
const T3_DELAY_MS = T2_DELAY_MS + 365 * DAY_MS; // "T2+12 mois" = T1+90j+365j

export interface VelocityTierInput {
  dgiVerificationStatus: DgiVerificationStatus;
  dgiVerifiedAt: Date | null;
  // Seul concept de "flag" existant dans ce repo : InvoiceEvent de type
  // suspicious_cash_pattern_detected (G1) — voir plan velocity-tier.
  hasAnomalyFlag: boolean;
  // Organization.paymentsFrozenUntil (G2) — un gel en cours force T0, quel que
  // soit le palier DGI réel (§3.3 : "reset PIN déclenche une bascule vers T0").
  forcedT0Until: Date | null;
}

// §4 Spec USSD — table exacte, montants en centimes GNF (convention repo).
export const VELOCITY_LIMITS_CENTIMES: Record<
  VelocityTier,
  { perAct: bigint; perDay: bigint; perWeek: bigint; perMonth: bigint }
> = {
  T0: { perAct: 50_000_000n, perDay: 150_000_000n, perWeek: 300_000_000n, perMonth: 600_000_000n },
  T1: { perAct: 400_000_000n, perDay: 400_000_000n, perWeek: 600_000_000n, perMonth: 1_000_000_000n },
  T2: { perAct: 2_000_000_000n, perDay: 2_000_000_000n, perWeek: 5_000_000_000n, perMonth: 10_000_000_000n },
  T3: { perAct: 8_000_000_000n, perDay: 8_000_000_000n, perWeek: 20_000_000_000n, perMonth: 40_000_000_000n },
};

export function resolveVelocityTier(input: VelocityTierInput): VelocityTier {
  if (input.forcedT0Until && input.forcedT0Until > new Date()) {
    return "T0";
  }

  if (input.dgiVerificationStatus !== "verified" || !input.dgiVerifiedAt) {
    return "T0";
  }

  const verifiedForMs = Date.now() - input.dgiVerifiedAt.getTime();

  if (input.hasAnomalyFlag || verifiedForMs < T2_DELAY_MS) {
    return "T1";
  }

  if (verifiedForMs < T3_DELAY_MS) {
    return "T2";
  }

  return "T3";
}
