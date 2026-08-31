import { z } from "zod";

// J2, ADR-116. `phone` volontairement permissif ici (z.string().min(1)) : la
// normalisation stricte + le rejet 400 sont faits par DataRightsService
// (normalizeMsisdn) — le service accepte les écritures usuelles (0X…, 224…,
// espaces) et les ramène à la forme canonique stockée en base.

/** Chemin PME : `organizationId` fourni par l'appelant, vérifié owner/admin par RolesGuard. */
export const dataRightsExportSchema = z.object({
  organizationId: z.string().uuid(),
  phone: z.string().min(1),
});
export type DataRightsExportDto = z.infer<typeof dataRightsExportSchema>;

/** Chemin ops plateforme : seul le numéro du sujet, portée transverse. */
export const opsSubjectSchema = z.object({
  phone: z.string().min(1),
});
export type OpsSubjectDto = z.infer<typeof opsSubjectSchema>;
