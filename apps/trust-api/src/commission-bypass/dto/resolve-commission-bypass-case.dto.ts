import { z } from "zod";

// G3, ADR-091 — dismiss : org repasse à none, override de seuil effacé.
// restrict : level_4_restricted, modélisé seulement (non appliqué ailleurs ce
// MVP, voir PLAN "Clarifications" — follow-up séparé pour le brancher sur
// plan-features-grid.ts). operatorId : identifiant libre de l'opérateur Squad
// Money (revue dev-domain-model-reviewer — traçabilité "qui", jamais une FK
// User puisque Squad Money n'y est représenté par aucune ligne).
export const resolveCommissionBypassCaseSchema = z.object({
  decision: z.enum(["dismiss", "restrict"]),
  operatorId: z.string().min(1),
});

export type ResolveCommissionBypassCaseDto = z.infer<typeof resolveCommissionBypassCaseSchema>;
