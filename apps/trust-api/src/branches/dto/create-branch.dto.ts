import { z } from "zod";

export const createBranchSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(["boutique", "entrepot", "agence", "en_ligne"]),
});

export type CreateBranchDto = z.infer<typeof createBranchSchema>;
