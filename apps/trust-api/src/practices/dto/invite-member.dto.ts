import { z } from "zod";
import { msisdnSchema } from "../../auth/dto/register.dto";

// role restreint à accountant_external au MVP (ADR-070) — business_manager reste
// V1, bien que scaffoldé dans PracticeMemberRole (schema.prisma), même précédent
// que create-mandate.dto.ts (F5).
export const inviteMemberSchema = z.object({
  msisdn: msisdnSchema,
  role: z.enum(["accountant_external"]),
});

export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;
