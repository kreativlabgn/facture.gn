import { z } from "zod";

// grantedRole restreint à accountant_external au MVP (ADR-070) — business_manager
// reste V1, bien que scaffoldé dans MandateGrantedRole (schema.prisma).
export const createMandateSchema = z.object({
  organizationId: z.string().uuid(),
  grantedRole: z.enum(["accountant_external"]),
});

export type CreateMandateDto = z.infer<typeof createMandateSchema>;
