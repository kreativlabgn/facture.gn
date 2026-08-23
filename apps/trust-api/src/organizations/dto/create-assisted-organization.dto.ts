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
  })
  // I4, ADR-057 — même règle que create-organization.dto.ts : l'exonération
  // association n'est jamais atteignable par legalForm=commercial, même via le
  // Chemin B assisté (l'agent terrain ne doit pas pouvoir contourner la règle du
  // Chemin A). Sens inverse volontairement pas contraint, voir justification dans
  // create-organization.dto.ts.
  .refine((data) => data.regimeFiscal !== "non_assujetti_association" || data.legalForm === "association", {
    message:
      "Le régime non_assujetti_association est réservé aux organisations legalForm=association (I4, ADR-057)",
    path: ["regimeFiscal"],
  });

export type CreateAssistedOrganizationDto = z.infer<typeof createAssistedOrganizationSchema>;
