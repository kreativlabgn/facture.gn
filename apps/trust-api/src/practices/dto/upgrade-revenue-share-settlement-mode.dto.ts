import { z } from "zod";

export const upgradeRevenueShareSettlementModeSchema = z.object({
  mode: z.enum(["payout", "subscription_deduction"]),
});

export type UpgradeRevenueShareSettlementModeDto = z.infer<typeof upgradeRevenueShareSettlementModeSchema>;
