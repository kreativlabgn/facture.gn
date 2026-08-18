import { z } from "zod";

export const resolveCreditLimitRequestSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

export type ResolveCreditLimitRequestDto = z.infer<typeof resolveCreditLimitRequestSchema>;
