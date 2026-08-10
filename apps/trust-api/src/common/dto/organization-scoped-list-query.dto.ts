import { z } from "zod";

// Partagé entre GET /invoices et GET /customers (premières routes de liste de ce
// repo) — organizationId toujours exigé : jamais de liste non scopée à une
// organisation, même pour un client déjà authentifié (RolesGuard vérifie
// séparément que le membership est actif, ce schéma valide seulement la forme).
// z.coerce nécessaire : les query params HTTP arrivent toujours en string.
export const organizationScopedListQuerySchema = z.object({
  organizationId: z.string().uuid(),
  take: z.coerce.number().int().positive().optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

export type OrganizationScopedListQueryDto = z.infer<typeof organizationScopedListQuerySchema>;
