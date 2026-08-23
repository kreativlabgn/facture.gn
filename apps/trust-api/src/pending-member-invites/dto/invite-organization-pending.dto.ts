import { z } from "zod";
import { msisdnSchema } from "../../auth/dto/register.dto";

// F10 — même catalogue de rôles que inviteOrganizationMemberSchema (F14/H1),
// jamais dupliqué par erreur avec une liste divergente : owner exclu (élévation
// de privilège hors périmètre de toute story), client_portal exclu (ADR-096,
// identité transverse auto-résolue, jamais un accès délégué invitable).
export const inviteOrganizationPendingSchema = z.object({
  msisdn: msisdnSchema,
  role: z.enum([
    "admin",
    "accountant_internal",
    "cashier",
    "field_agent",
    "delivery_driver",
    "auditor",
    "approver",
    "tax_controller_readonly",
    "developer_api",
    "inventory_manager",
    "viewer",
  ]),
});

export type InviteOrganizationPendingDto = z.infer<typeof inviteOrganizationPendingSchema>;
