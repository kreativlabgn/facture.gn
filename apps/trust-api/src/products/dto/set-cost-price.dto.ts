import { z } from "zod";

export const setCostPriceSchema = z.object({
  costPrice: z.coerce.bigint().nonnegative(),
});

export type SetCostPriceDto = z.infer<typeof setCostPriceSchema>;
