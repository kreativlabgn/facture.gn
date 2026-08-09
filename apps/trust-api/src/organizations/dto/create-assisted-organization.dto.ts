import { z } from "zod";
import { msisdnSchema } from "../../auth/dto/register.dto";

// B5, ADR-045 — mêmes champs organisation que create-organization.dto.ts (le refine
// NIF/eTax conjoint est dupliqué à l'identique : createOrganizationSchema est un
// ZodEffects post-refine, non extensible via .extend()). merchantName/msisdn décrivent
// le marchand Chemin B créé par l'agent, jamais l'agent lui-même. consentRecorded en
// z.literal(true) — jamais un booléen avec défaut, cohérent avec le reste du schema
// (voir addPhoneSchema pour le même principe sur la re-confirmation).
export const createAssistedOrganizationSchema = z
  .object({
    organizationName: z.string().min(1),
    regimeFiscal: z.enum(["normal_tva", "tpu", "normal_sans_tva", "non_assujetti_association"]),
    legalForm: z.enum(["commercial", "association"]),
    nif: z.string().min(1).optional(),
    etaxNumber: z.string().min(1).optional(),
    merchantName: z.string().min(1),
    msisdn: msisdnSchema.optional(),
    consentRecorded: z.literal(true),
  })
  .refine((data) => (data.nif === undefined) === (data.etaxNumber === undefined), {
    message: "NIF et eTax sont exigés conjointement (ADR-035) — les deux ou aucun des deux",
    path: ["nif"],
  });

export type CreateAssistedOrganizationDto = z.infer<typeof createAssistedOrganizationSchema>;
