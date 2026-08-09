import { z } from "zod";

// F12 — organisation-initiated, contrepartie de createMandateSchema (practice-
// initiated). Aucun grantedRole exposé : fixé serveur à accountant_external
// (même restriction MVP qu'ADR-070).
export const requestMandateSchema = z.object({
  practiceId: z.string().uuid(),
});

export type RequestMandateDto = z.infer<typeof requestMandateSchema>;
