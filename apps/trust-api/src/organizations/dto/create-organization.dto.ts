import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().min(1),
  // Obligatoire, sans .default() — jamais un défaut TVA silencieux (DAT §4).
  regimeFiscal: z.enum(["normal_tva", "tpu", "normal_sans_tva", "non_assujetti_association"]),
  legalForm: z.enum(["commercial", "association"]),
  nif: z.string().min(1),
  etaxNumber: z.string().optional(),
  rccm: z.string().optional(),
});

export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;
