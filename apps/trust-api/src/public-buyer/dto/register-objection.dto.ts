import { z } from "zod";

export const registerObjectionSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

export type RegisterObjectionDto = z.infer<typeof registerObjectionSchema>;
