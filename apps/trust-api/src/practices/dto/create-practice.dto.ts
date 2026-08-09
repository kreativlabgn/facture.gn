import { z } from "zod";
import { msisdnSchema } from "../../auth/dto/register.dto";

export const createPracticeSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["cabinet_comptable", "gestionnaire", "fiduciaire", "cga"]),
  registrationNumber: z.string().min(1).optional(),
  phone: msisdnSchema,
  email: z.string().email().optional(),
});

export type CreatePracticeDto = z.infer<typeof createPracticeSchema>;
