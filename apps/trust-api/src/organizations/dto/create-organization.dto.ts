import { z } from "zod";

export const createOrganizationSchema = z
  .object({
    name: z.string().min(1),
    // Obligatoire, sans .default() — jamais un défaut TVA silencieux (DAT §4).
    regimeFiscal: z.enum(["normal_tva", "tpu", "normal_sans_tva", "non_assujetti_association"]),
    legalForm: z.enum(["commercial", "association"]),
    // Optionnels à l'inscription (ADR-035, story B4) — jamais un gate sur l'usage de
    // base (ADR-036). Self-service Chemin A : Aissatou/Aminata peuvent émettre leur
    // première facture en < 5 min sans avoir leur NIF sous la main.
    nif: z.string().min(1).optional(),
    etaxNumber: z.string().min(1).optional(),
    rccm: z.string().optional(),
  })
  .refine((data) => (data.nif === undefined) === (data.etaxNumber === undefined), {
    message: "NIF et eTax sont exigés conjointement (ADR-035) — les deux ou aucun des deux",
    path: ["nif"],
  });

export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;
