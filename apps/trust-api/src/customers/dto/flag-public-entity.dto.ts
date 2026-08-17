import { z } from "zod";

export const flagPublicEntitySchema = z.object({
  publicBuyerAccountId: z.string().uuid(),
});

export type FlagPublicEntityDto = z.infer<typeof flagPublicEntitySchema>;
