import { Prisma, type PrismaClient } from "@prisma/client";

// Lot I (C2) — Row-Level Security PostgreSQL par organisation.
//
// La migration 20260829150000_enable_row_level_security pose des politiques
// `USING (current_setting('app.current_org_id', true) IS NULL OR organization_id = ...)`.
// Tant que le paramètre de session n'est pas défini, les politiques laissent
// tout passer (dormantes). `organizationScopedClient` est le seul point qui le
// définit : chaque opération est exécutée dans une transaction qui commence par
//   SELECT set_config('app.current_org_id', <orgId>, TRUE)
// (`is_local = TRUE` → portée transaction, compatible pooling transaction-mode
// type PgBouncer, contrairement à un `SET` de session).
//
// Adoption : explicite, par appel, là où le service connaît déjà son orgId —
//   organizationScopedClient(this.prisma, organizationId).invoice.findMany({ ... })
// Aucun câblage global (voir ADR-111 + docs/runbooks/rls-rollout.md).

export const RLS_ORG_SETTING = "app.current_org_id";

type AllOperationsArgs = {
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
};

// Extrait et exporté pour le test unitaire : enveloppe UNE opération Prisma dans
// une transaction précédée du set_config. `baseClient` (client non étendu) porte
// le `$transaction` / `$executeRaw` réels — appelés hors de l'extension, donc
// jamais ré-interceptés.
export function makeOrgScopedOperation(
  baseClient: Pick<PrismaClient, "$transaction" | "$executeRaw">,
  organizationId: string,
) {
  return async ({ args, query }: AllOperationsArgs): Promise<unknown> => {
    const setConfig = baseClient.$executeRaw(
      Prisma.sql`SELECT set_config(${RLS_ORG_SETTING}, ${organizationId}, TRUE)`,
    );
    // `query(args)` renvoie une PrismaPromise à l'exécution ; le type n'est pas
    // porté par notre wrapper générique, d'où le cast pour la forme array de
    // $transaction (qui exécute les deux requêtes dans la même transaction).
    const inTx = [setConfig, query(args) as Prisma.PrismaPromise<unknown>];
    const [, result] = await baseClient.$transaction(inTx);
    return result;
  };
}

export function organizationScopedClient(client: PrismaClient, organizationId: string) {
  assertOrganizationId(organizationId);
  return client.$extends({
    query: {
      $allModels: {
        $allOperations: makeOrgScopedOperation(client, organizationId),
      },
    },
  });
}

export type OrganizationScopedClient = ReturnType<typeof organizationScopedClient>;

// À utiliser À L'INTÉRIEUR d'une transaction interactive : `organizationScopedClient`
// ne convient PAS là (chaque opération y ouvrirait sa propre transaction → imbrication).
//   await prisma.$transaction(async (tx) => {
//     await setOrganizationScope(tx, organizationId);
//     await tx.invoice.update({ ... });   // RLS appliqué pour le reste de la tx
//   });
export async function setOrganizationScope(
  tx: { $executeRaw: PrismaClient["$executeRaw"] },
  organizationId: string,
): Promise<void> {
  assertOrganizationId(organizationId);
  await tx.$executeRaw(Prisma.sql`SELECT set_config(${RLS_ORG_SETTING}, ${organizationId}, TRUE)`);
}

function assertOrganizationId(organizationId: string): void {
  if (typeof organizationId !== "string" || organizationId.trim() === "") {
    throw new Error("RLS : organizationId non vide requis");
  }
}
