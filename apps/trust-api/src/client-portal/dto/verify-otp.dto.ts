import { z } from "zod";
import { msisdnSchema } from "../../auth/dto/register.dto";

export const verifyOtpSchema = z.object({
  msisdn: msisdnSchema,
  code: z.string().regex(/^\d{4}$/, "code attendu à 4 chiffres"),
});

export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;
