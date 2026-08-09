import { z } from "zod";

export const mergeCustomerSchema = z.object({
  duplicateCustomerId: z.string().uuid(),
});

export type MergeCustomerDto = z.infer<typeof mergeCustomerSchema>;
