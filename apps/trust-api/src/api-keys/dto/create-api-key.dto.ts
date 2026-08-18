import { z } from "zod";

export const createApiKeySchema = z.object({
  environment: z.enum(["production", "sandbox"]),
});

export type CreateApiKeyDto = z.infer<typeof createApiKeySchema>;
