import { z } from "zod";
import { msisdnSchema } from "./register.dto";

export const addPhoneSchema = z.object({
  msisdn: msisdnSchema,
});

export type AddPhoneDto = z.infer<typeof addPhoneSchema>;
