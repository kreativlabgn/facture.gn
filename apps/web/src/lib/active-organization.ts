import { cookies } from "next/headers";
import { listMyOrganizations, type OrganizationSummary } from "./trust-api";

// Organisation active du multi-organisation (OrgSwitcher, ADR-095). Remplace
// le `organizations[0]` codé en dur des anciens layouts, qui condamnait un
// utilisateur rattaché à plusieurs organisations à toujours voir la première.
//
// Le choix vit dans un cookie, pas dans l'URL : chaque écran de /dashboard
// resterait sinon à réécrire pour porter un ?organizationId=, et un lien
// partagé emmènerait le destinataire dans une organisation qui n'est pas la
// sienne. Le cookie n'est PAS une autorisation : son contenu est confronté à
// la liste réelle des organisations du porteur du JWT à chaque résolution, et
// un identifiant absent de cette liste est ignoré, jamais utilisé. Falsifier
// le cookie ne donne donc accès à rien — au pire il est sans effet.
export const ACTIVE_ORGANIZATION_COOKIE = "fg_active_org";

export interface ActiveOrganizationContext {
  organizations: OrganizationSummary[];
  active: OrganizationSummary | null;
}

// Pure — le cœur de la règle, testable sans cookies() ni fetch.
export function pickActiveOrganization(
  organizations: readonly OrganizationSummary[],
  preferredId: string | null,
): OrganizationSummary | null {
  const preferred = preferredId ? organizations.find((organization) => organization.id === preferredId) : undefined;
  return preferred ?? organizations[0] ?? null;
}

export async function resolveActiveOrganization(token: string): Promise<ActiveOrganizationContext> {
  const [organizations, store] = await Promise.all([listMyOrganizations(token), cookies()]);
  const preferredId = store.get(ACTIVE_ORGANIZATION_COOKIE)?.value ?? null;
  return { organizations, active: pickActiveOrganization(organizations, preferredId) };
}
