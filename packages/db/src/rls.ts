import { Prisma, type PrismaClient } from "@prisma/client";

// Lot I (C2) + Chantier A (ADR-111 phase 2) — Row-Level Security PostgreSQL.
//
// La migration 20260829150000_enable_row_level_security pose des politiques
// `org_isolation` par ORGANISATION ; 20260905120000_rls_practice_scope les étend
// au scope PRACTICE (cabinet/CGA voit ses organisations MANDATÉES). Prédicat :
//   USING ( (app.current_org_id IS NULL AND app.current_practice_id IS NULL)  -- dormant
//           OR organization_id = current_setting('app.current_org_id', true)
//           OR rls_practice_sees_org(organization_id) )
// Tant qu'aucun des deux GUC de session n'est défini, les politiques laissent
// tout passer (dormantes).
//
// `organizationScopedClient` / `practiceScopedClient` sont les seuls points qui
// posent ces GUC : chaque opération est exécutée dans une transaction qui commence
// par `SELECT set_config(<clé>, <id>, TRUE)` (`is_local = TRUE` → portée
// transaction, compatible pooling transaction-mode type PgBouncer / Supavisor,
// contrairement à un `SET` de session).
//
// Adoption : explicite, par appel, là où le service connaît déjà son scope —
//   organizationScopedClient(this.prisma, organizationId).invoice.findMany({ ... })
//   practiceScopedClient(this.prisma, practiceId).invoice.findMany({ ... })  // vue multi-org mandatée
// Aucun câblage global (voir ADR-111 + docs/runbooks/rls-rollout.md).

export const RLS_ORG_SETTING = "app.current_org_id";
export const RLS_PRACTICE_SETTING = "app.current_practice_id";

type AllOperationsArgs = {
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
};

// Enveloppe UNE opération Prisma dans une transaction précédée du set_config.
// `baseClient` (client non étendu) porte le `$transaction` / `$executeRaw` réels —
// appelés hors de l'extension, donc jamais ré-interceptés.
function makeScopedOperation(
  baseClient: Pick<PrismaClient, "$transaction" | "$executeRaw">,
  settingKey: string,
  scopeId: string,
) {
  return async ({ args, query }: AllOperationsArgs): Promise<unknown> => {
    const setConfig = baseClient.$executeRaw(
      Prisma.sql`SELECT set_config(${settingKey}, ${scopeId}, TRUE)`,
    );
    // `query(args)` renvoie une PrismaPromise à l'exécution ; le type n'est pas
    // porté par notre wrapper générique, d'où le cast pour la forme array de
    // $transaction (qui exécute les deux requêtes dans la même transaction).
    const inTx = [setConfig, query(args) as Prisma.PrismaPromise<unknown>];
    const [, result] = await baseClient.$transaction(inTx);
    return result;
  };
}

// Extrait et exporté pour le test unitaire.
export function makeOrgScopedOperation(
  baseClient: Pick<PrismaClient, "$transaction" | "$executeRaw">,
  organizationId: string,
) {
  return makeScopedOperation(baseClient, RLS_ORG_SETTING, organizationId);
}

export function makePracticeScopedOperation(
  baseClient: Pick<PrismaClient, "$transaction" | "$executeRaw">,
  practiceId: string,
) {
  return makeScopedOperation(baseClient, RLS_PRACTICE_SETTING, practiceId);
}

export function organizationScopedClient(client: PrismaClient, organizationId: string) {
  assertScopeId(organizationId, "organizationId");
  return client.$extends({
    query: {
      $allModels: {
        $allOperations: makeOrgScopedOperation(client, organizationId),
      },
    },
  });
}

// Vue transversale d'un cabinet/CGA : voit les données de TOUTES ses organisations
// à mandat `active` non expiré (DAT §7.2). L'accès concret ligne à ligne est
// tranché par la politique `org_isolation` via `rls_practice_sees_org()`.
export function practiceScopedClient(client: PrismaClient, practiceId: string) {
  assertScopeId(practiceId, "practiceId");
  return client.$extends({
    query: {
      $allModels: {
        $allOperations: makePracticeScopedOperation(client, practiceId),
      },
    },
  });
}

export type OrganizationScopedClient = ReturnType<typeof organizationScopedClient>;
export type PracticeScopedClient = ReturnType<typeof practiceScopedClient>;

// À utiliser À L'INTÉRIEUR d'une transaction interactive : les `*ScopedClient`
// ne conviennent PAS là (chaque opération y ouvrirait sa propre transaction → imbrication).
//   await prisma.$transaction(async (tx) => {
//     await setOrganizationScope(tx, organizationId);
//     await tx.invoice.update({ ... });   // RLS appliqué pour le reste de la tx
//   });
// Poser les DEUX (cabinet « entré » dans une organisation précise) = appeler
// setOrganizationScope puis setPracticeScope dans la même transaction.
export async function setOrganizationScope(
  tx: { $executeRaw: PrismaClient["$executeRaw"] },
  organizationId: string,
): Promise<void> {
  assertScopeId(organizationId, "organizationId");
  await tx.$executeRaw(Prisma.sql`SELECT set_config(${RLS_ORG_SETTING}, ${organizationId}, TRUE)`);
}

export async function setPracticeScope(
  tx: { $executeRaw: PrismaClient["$executeRaw"] },
  practiceId: string,
): Promise<void> {
  assertScopeId(practiceId, "practiceId");
  await tx.$executeRaw(Prisma.sql`SELECT set_config(${RLS_PRACTICE_SETTING}, ${practiceId}, TRUE)`);
}

function assertScopeId(value: string, label: "organizationId" | "practiceId"): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`RLS : ${label} non vide requis`);
  }
}
