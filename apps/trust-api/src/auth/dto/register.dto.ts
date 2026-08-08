import { z } from "zod";

// Format Guinée E.164 : +224 suivi de 8 ou 9 chiffres (ADR-087, USER_PHONE).
const msisdnSchema = z.string().regex(/^\+224\d{8,9}$/, "msisdn attendu au format +224XXXXXXXXX");

export const registerSchema = z.object({
  name: z.string().min(1),
  msisdn: msisdnSchema,
  password: z.string().min(8),
});

export type RegisterDto = z.infer<typeof registerSchema>;
