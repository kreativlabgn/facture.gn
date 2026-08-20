import { z } from "zod";
import { msisdnSchema } from "../../auth/dto/register.dto";

// F14, ADR-104 — restreint initialement à tax_controller_readonly seul ; élargi
// en H1 (Grille §2) à tout le catalogue OrganizationRole SAUF owner, jamais
// assignable par invitation (uniquement à la création de l'organisation,
// organizations.service.ts::create()) — élévation de privilège hors périmètre
// de toute story, pas seulement F14. La disponibilité effective d'un rôle selon
// le palier commercial de l'organisation est vérifiée séparément par
// plan-features-grid.ts::isRoleAllowedForTier(), pas ici (Zod valide la forme,
// pas le business). client_portal SAUF également (ADR-096, ADR-108) : identité
// transverse auto-résolue par téléphone vérifié, jamais un accès délégué que
// l'organisation accorde ou révoque — l'inclure ici créerait un OrganizationMember
// révocable, contradiction directe avec la décision. H1 l'avait élargi par erreur
// le même jour où ADR-096 a été acté, sans réconciliation des deux.
export const inviteOrganizationMemberSchema = z.object({
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
  ]),
});

export type InviteOrganizationMemberDto = z.infer<typeof inviteOrganizationMemberSchema>;
