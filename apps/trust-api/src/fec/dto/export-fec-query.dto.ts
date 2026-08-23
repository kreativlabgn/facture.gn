import { z } from "zod";

// Quality Audit 2026-08-23, finding #7 — un export FEC se fait normalement par
// exercice fiscal (année), jamais l'historique complet de l'organisation.
// Optionnel, défaut sur l'année en cours (FecService.export()) : le cas le
// plus fréquent (clôturer l'exercice qui vient de se terminer) reste un
// simple GET sans paramètre, un exercice antérieur reste accessible via ?year=.
export const exportFecQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export type ExportFecQueryDto = z.infer<typeof exportFecQuerySchema>;
