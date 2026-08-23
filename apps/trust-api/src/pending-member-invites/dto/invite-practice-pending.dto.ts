import { z } from "zod";
import { msisdnSchema } from "../../auth/dto/register.dto";

// F10 — même restriction que inviteMemberSchema (F8) : accountant_external
// seul au MVP (ADR-070), business_manager reste V1.
export const invitePracticePendingSchema = z.object({
  msisdn: msisdnSchema,
  role: z.enum(["accountant_external"]),
});

export type InvitePracticePendingDto = z.infer<typeof invitePracticePendingSchema>;
