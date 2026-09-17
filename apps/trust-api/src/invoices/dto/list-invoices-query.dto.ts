import { z } from "zod";
import { organizationScopedListQuerySchema } from "../../common/dto/organization-scoped-list-query.dto";

// Lot D — extension propre à GET /invoices (jamais toucher le schéma partagé
// organizationScopedListQuerySchema, qui sert aussi à GET /customers où le
// canal d'émission n'a aucun sens). Filtre optionnel : une requête sans
// emissionChannel liste toutes les factures, comportement inchangé.
export const listInvoicesQuerySchema = organizationScopedListQuerySchema.extend({
  // "whatsapp" ajouté par le plan 2026-09-16 (OCR multicanal) : un brouillon
  // né d'un message WhatsApp (emissionChannelForSource) doit rester visible à
  // ce filtre, comme les autres canaux.
  emissionChannel: z.enum(["pwa", "ussd", "agent_terrain", "api", "whatsapp"]).optional(),
});

export type ListInvoicesQueryDto = z.infer<typeof listInvoicesQuerySchema>;
