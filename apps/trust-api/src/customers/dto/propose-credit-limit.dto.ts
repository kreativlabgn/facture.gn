import { z } from "zod";

export const proposeCreditLimitSchema = z.object({
  newLimit: z.coerce.bigint().nonnegative(),
});

export type ProposeCreditLimitDto = z.infer<typeof proposeCreditLimitSchema>;
