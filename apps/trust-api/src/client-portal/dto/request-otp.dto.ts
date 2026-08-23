import { z } from "zod";
import { msisdnSchema } from "../../auth/dto/register.dto";

export const requestOtpSchema = z.object({
  msisdn: msisdnSchema,
});

export type RequestOtpDto = z.infer<typeof requestOtpSchema>;
