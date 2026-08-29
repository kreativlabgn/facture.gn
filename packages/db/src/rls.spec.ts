import { describe, expect, it, vi } from "vitest";

import { makeOrgScopedOperation, organizationScopedClient, RLS_ORG_SETTING, setOrganizationScope } from "./rls";

describe("makeOrgScopedOperation", () => {
  it("exécute set_config(app.current_org_id, <orgId>, TRUE) puis l'opération, dans une seule transaction", async () => {
    const setConfigHandle = Symbol("set_config");
    const queryHandle = Symbol("query");

    const baseClient = {
      $executeRaw: vi.fn().mockReturnValue(setConfigHandle),
      $transaction: vi.fn().mockResolvedValue([1, "RESULTAT"]),
    };
    const query = vi.fn().mockReturnValue(queryHandle);

    const op = makeOrgScopedOperation(baseClient as never, "org_abc");
    const result = await op({ args: { where: { id: "x" } }, query });

    // set_config paramétré (pas d'interpolation de chaîne)
    const sql = baseClient.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sql.values).toEqual([RLS_ORG_SETTING, "org_abc"]);

    // la transaction reçoit [handle du set_config, handle de la requête] dans cet ordre
    expect(baseClient.$transaction).toHaveBeenCalledWith([setConfigHandle, queryHandle]);

    // la requête d'origine reçoit ses args intacts
    expect(query).toHaveBeenCalledWith({ where: { id: "x" } });

    // le résultat retourné est le 2e élément du tuple de transaction
    expect(result).toBe("RESULTAT");
  });
});

describe("organizationScopedClient", () => {
  it("rejette un organizationId vide ou non-chaîne", () => {
    const client = { $extends: vi.fn() } as never;
    expect(() => organizationScopedClient(client, "")).toThrow(/organizationId/);
    expect(() => organizationScopedClient(client, "   ")).toThrow(/organizationId/);
    expect(() => organizationScopedClient(client, undefined as never)).toThrow(/organizationId/);
  });

  it("dérive l'assertion d'orgId (setOrganizationScope rejette aussi)", async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) };
    await expect(setOrganizationScope(tx as never, "")).rejects.toThrow(/organizationId/);

    await setOrganizationScope(tx as never, "org_xyz");
    const sql = tx.$executeRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sql.values).toEqual([RLS_ORG_SETTING, "org_xyz"]);
  });

  it("étend le client avec un hook $allOperations sur tous les modèles", () => {
    const extended = Symbol("extended");
    const client = { $extends: vi.fn().mockReturnValue(extended), $executeRaw: vi.fn(), $transaction: vi.fn() } as never;

    const result = organizationScopedClient(client, "org_abc");

    expect(result).toBe(extended);
    const extendArg = (client as unknown as { $extends: ReturnType<typeof vi.fn> }).$extends.mock.calls[0][0] as {
      query: { $allModels: { $allOperations: unknown } };
    };
    expect(typeof extendArg.query.$allModels.$allOperations).toBe("function");
  });
});
