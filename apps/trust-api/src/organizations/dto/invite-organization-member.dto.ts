import { z } from "zod";
import { msisdnSchema } from "../../auth/dto/register.dto";

// F14, ADR-104 — role restreint à tax_controller_readonly pour cette story,
// même précédent que practices/dto/invite-member.dto.ts (F8) : champ nommé
// génériquement pour une extension future naturelle, mais pas d'autre valeur
// acceptée tant qu'aucune autre story ne le justifie.
export const inviteOrganizationMemberSchema = z.object({
  msisdn: msisdnSchema,
  role: z.enum(["tax_controller_readonly"]),
});

export type InviteOrganizationMemberDto = z.infer<typeof inviteOrganizationMemberSchema>;
