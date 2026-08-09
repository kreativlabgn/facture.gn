import { z } from "zod";
import { msisdnSchema } from "./register.dto";

export const requestRecoverySchema = z.object({
  msisdn: msisdnSchema,
  organizationNif: z.string().min(1),
});

export type RequestRecoveryDto = z.infer<typeof requestRecoverySchema>;
