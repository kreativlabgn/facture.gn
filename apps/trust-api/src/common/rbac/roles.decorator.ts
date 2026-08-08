import { SetMetadata } from "@nestjs/common";
import type { OrganizationRole } from "@facture-gn/db";

export const ROLES_KEY = "roles";

// Rôles organisationnels autorisés pour cette route — vérifiés par RolesGuard contre
// OrganizationMember à chaque requête (jamais depuis le JWT, voir auth-token.service.ts).
export const Roles = (...roles: OrganizationRole[]) => SetMetadata(ROLES_KEY, roles);
