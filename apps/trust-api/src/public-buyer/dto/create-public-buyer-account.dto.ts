import { z } from "zod";

export const createPublicBuyerAccountSchema = z.object({
  name: z.string().min(1),
});

export type CreatePublicBuyerAccountDto = z.infer<typeof createPublicBuyerAccountSchema>;
