import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";
export {
  RLS_ORG_SETTING,
  makeOrgScopedOperation,
  organizationScopedClient,
  setOrganizationScope,
  type OrganizationScopedClient,
} from "./rls";

let prisma: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}
