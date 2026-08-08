import { z } from "zod";

export const loginSchema = z.object({
  msisdn: z.string().regex(/^\+224\d{8,9}$/, "msisdn attendu au format +224XXXXXXXXX"),
  password: z.string().min(1),
});

export type LoginDto = z.infer<typeof loginSchema>;
