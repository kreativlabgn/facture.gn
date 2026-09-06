import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";
export {
  RLS_ORG_SETTING,
  RLS_PRACTICE_SETTING,
  makeOrgScopedOperation,
  makePracticeScopedOperation,
  organizationScopedClient,
  practiceScopedClient,
  setOrganizationScope,
  setPracticeScope,
  type OrganizationScopedClient,
  type PracticeScopedClient,
} from "./rls";

let prisma: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}
