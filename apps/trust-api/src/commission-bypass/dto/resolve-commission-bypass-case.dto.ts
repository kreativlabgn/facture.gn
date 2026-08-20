import { z } from "zod";

// G3, ADR-091 — dismiss : org repasse à none, override de seuil effacé.
// restrict : level_4_restricted, modélisé seulement (non appliqué ailleurs ce
// MVP, voir PLAN "Clarifications" — follow-up séparé pour le brancher sur
// plan-features-grid.ts).
export const resolveCommissionBypassCaseSchema = z.object({
  decision: z.enum(["dismiss", "restrict"]),
});

export type ResolveCommissionBypassCaseDto = z.infer<typeof resolveCommissionBypassCaseSchema>;
