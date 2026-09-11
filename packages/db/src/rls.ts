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

// ── POURQUOI UN TYPE DE RETOUR ANNOTÉ, ET PAS L'INFÉRENCE DE $extends ───────
//
// Le type que `$extends` infère porte les paramètres génériques de l'extension
// (`InternalArgs<...>`) au lieu de `DefaultArgs`. Les délégués de modèles y sont
// STRUCTURELLEMENT identiques — une extension `query` intercepte l'exécution,
// elle ne change ni les arguments acceptés ni les valeurs rendues, contrairement
// à une extension `result` ou `model` — mais NOMINALEMENT différents. Chaque
// appel devait donc réconcilier deux arbres de types complets.
//
// Ça tenait, de justesse. Le modèle PdpRawTransaction (ADR-107, 29e table du
// registre RLS) a fait franchir à TypeScript sa limite d'instanciation : les
// quatre endroits qui manipulent une UNION `PrismaClient | client scopé` —
// `tx ?? organizationScopedClient(...)` dans OrganizationSigningKeyService,
// `organizationId ? ... : this.prisma` dans DataRightsService — se sont mis à
// échouer d'un coup (TS2321 « Excessive stack depth », puis TS2349 « none of
// those signatures are compatible »), dans des fichiers que la story ne touchait
// pas. Le seuil est atteint par le NOMBRE DE MODÈLES, pas par ce que ce
// modèle-ci contient : n'importe quelle table ajoutée ensuite l'aurait déclenché,
// et le prochain qui l'aurait vu n'aurait eu aucun moyen de relier la panne à sa
// cause.
//
// Annoter le retour coupe la racine du problème : l'union devient
// `PrismaClient | PrismaClient`, TypeScript n'a plus rien à réconcilier, et les
// 107 usages directs continuent de se vérifier exactement comme avant. Le cast
// est le prix à payer — `$extends` retire `$use`/`$on` de sa signature, si bien
// que son résultat n'est pas assignable à PrismaClient sans lui, alors même que
// tout ce qu'on utilise (les délégués de modèles, `$transaction`, `$executeRaw`)
// y est présent et compatible.
//
// Ce que l'annotation NE dit pas : qu'un client scopé s'utilise comme un client
// normal. La mise en garde ci-dessous vaut plus que jamais — `$transaction` est
// désormais visible sur le type rendu, et l'appeler ouvrirait une transaction
// imbriquée dans celle que chaque opération scopée ouvre déjà.
export function organizationScopedClient(client: PrismaClient, organizationId: string): PrismaClient {
  assertScopeId(organizationId, "organizationId");
  return client.$extends({
    query: {
      $allModels: {
        $allOperations: makeOrgScopedOperation(client, organizationId),
      },
    },
  }) as unknown as PrismaClient;
}

// Vue transversale d'un cabinet/CGA : voit les données de TOUTES ses organisations
// à mandat `active` non expiré (DAT §7.2). L'accès concret ligne à ligne est
// tranché par la politique `org_isolation` via `rls_practice_sees_org()`.
// Même annotation, même raison qu'organizationScopedClient ci-dessus — et pas
// seulement par symétrie : MandatesService prend en paramètre
// `OrganizationScopedClient | PracticeScopedClient`, l'union exacte que ce
// changement collapse.
export function practiceScopedClient(client: PrismaClient, practiceId: string): PrismaClient {
  assertScopeId(practiceId, "practiceId");
  return client.$extends({
    query: {
      $allModels: {
        $allOperations: makePracticeScopedOperation(client, practiceId),
      },
    },
  }) as unknown as PrismaClient;
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
