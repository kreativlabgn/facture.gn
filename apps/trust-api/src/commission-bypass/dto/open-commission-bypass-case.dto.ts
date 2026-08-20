import { z } from "zod";

// G3, ADR-091 — detectedPatterns : snapshot fourni par l'opérateur Squad Money
// (lu depuis le journal d'audit G4 avant d'agir), jamais recalculé côté serveur —
// seule trace du "pourquoi" (aucun "qui", voir E-2 du blueprint).
export const openCommissionBypassCaseSchema = z.object({
  detectedPatterns: z.array(z.string()).min(1),
});

export type OpenCommissionBypassCaseDto = z.infer<typeof openCommissionBypassCaseSchema>;
