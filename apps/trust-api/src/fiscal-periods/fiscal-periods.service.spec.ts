import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { FiscalPeriodsService } from "./fiscal-periods.service";

// organizationScopedClient() appelle `$extends`, et setOrganizationScope() pose le
// GUC via `$executeRaw`. Le vrai client offre les deux ; un faux qui ne les offre
// pas ne teste pas le service migré, il plante dessus. `$extends` rend le client
// LUI-MÊME pour que les mocks restent partagés. `$transaction` bi-forme : la forme
// tableau est celle qu'emploie makeScopedOperation(), ce qui rend l'extension
// rejouable — indispensable pour épingler la VALEUR du client scopé.
function auClientScope<T extends Record<string, unknown>>(prisma: T): T {
  const p = prisma as Record<string, unknown>;
  p.$extends = vi.fn(() => prisma);
  p.$executeRaw = p.$executeRaw ?? vi.fn().mockResolvedValue(1);
  p.$transaction = p.$transaction ?? vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  for (const valeur of Object.values(p)) {
    const modele = valeur as Record<string, unknown> | null;
    if (!modele || typeof modele !== "object") continue;
    if (modele.findUniqueOrThrow && !modele.findFirstOrThrow) modele.findFirstOrThrow = modele.findUniqueOrThrow;
    if (modele.findUnique && !modele.findFirst) modele.findFirst = modele.findUnique;
  }
  return prisma;
}

// La clôture enfile désormais une déclaration eTax. Le faux ne lève jamais —
// comme le vrai : une file indisponible ne doit pas défaire une clôture
// comptable déjà commitée.
function fakeEtaxSync() {
  return { enqueueForClosing: vi.fn().mockResolvedValue(undefined) };
}

const CURRENT_YEAR = new Date().getUTCFullYear();
const CLOSABLE_YEAR = CURRENT_YEAR - 1;

function fakePrisma(overrides: {
  aggregate?: unknown;
  lastInvoice?: unknown;
  createImpl?: (args: unknown) => unknown;
  closings?: unknown[];
} = {}) {
  const prisma: any = auClientScope({
    invoice: {
      aggregate: vi.fn().mockResolvedValue(
        overrides.aggregate ?? {
          _sum: { totalHt: 91_000_000_00n, totalTva: 16_380_000_00n, totalTtc: 107_380_000_00n },
          _count: 412,
        },
      ),
      findFirst: vi.fn().mockResolvedValue(
        "lastInvoice" in overrides ? overrides.lastInvoice : { number: `FG-${CLOSABLE_YEAR}-000412`, hash: "deadbeef" },
      ),
    },
    fiscalPeriodClosing: {
      create: vi.fn().mockImplementation(
        overrides.createImpl ?? (({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "fpc-1", ...data })),
      ),
      findMany: vi.fn().mockResolvedValue(overrides.closings ?? []),
    },
    // Bi-forme : le callback interactif du service ET la forme tableau
    // qu'emploie makeScopedOperation(), qui rend l'extension rejouable.
    $transaction: vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma))),
    $executeRaw: vi.fn().mockResolvedValue(1),
  });
  return prisma;
}

describe("FiscalPeriodsService.close", () => {
  // DOUBLE ÉPINGLAGE. Le GUC transactionnel (setOrganizationScope, posé par
  // close()) et le client scopé (organizationScopedClient, utilisé par
  // listByOrganization()) sont deux constructions distinctes : une assertion sur
  // l'une ne couvre pas l'autre. Les faux `$extends` se renvoyant eux-mêmes, la
  // valeur du client scopé n'est observable qu'en rejouant l'extension capturée.
  it("pose app.current_org_id en tête de la transaction de clôture", async () => {
    const prisma = fakePrisma();
    const service = new FiscalPeriodsService(prisma as never, fakeEtaxSync() as never);

    await service.close("org-a-proteger", CLOSABLE_YEAR, "user-1");

    const setConfig = (prisma as any).$executeRaw.mock.calls[0]?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-a-proteger");
  });

  it("pose le même scope sur le CLIENT SCOPÉ de la lecture des clôtures", async () => {
    const prisma = fakePrisma();
    const service = new FiscalPeriodsService(prisma as never, fakeEtaxSync() as never);

    await service.listByOrganization("org-a-proteger");

    const extension = (prisma as any).$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });

    const setConfig = (prisma as any).$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-a-proteger");
  });


  it("refuse de clôturer une année future", async () => {
    const service = new FiscalPeriodsService(fakePrisma() as never, fakeEtaxSync() as never);
    await expect(service.close("org-1", CURRENT_YEAR + 1, "user-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuse une année absurde (avant 2020)", async () => {
    const service = new FiscalPeriodsService(fakePrisma() as never, fakeEtaxSync() as never);
    await expect(service.close("org-1", 1998, "user-1")).rejects.toBeInstanceOf(ConflictException);
    await expect(service.close("org-1", -5, "user-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("agrège les factures émises de l'année (bornes UTC) et le dernier numéro/hash", async () => {
    const prisma = fakePrisma();
    const service = new FiscalPeriodsService(prisma as never, fakeEtaxSync() as never);

    const closing = await service.close("org-1", CLOSABLE_YEAR, "user-1");

    const aggregateWhere = (prisma.invoice.aggregate as any).mock.calls[0][0].where;
    expect(aggregateWhere.organizationId).toBe("org-1");
    expect(aggregateWhere.status.in).toEqual(expect.arrayContaining(["issued", "paid", "voided"]));
    expect(aggregateWhere.issuedAt.gte.toISOString()).toBe(`${CLOSABLE_YEAR}-01-01T00:00:00.000Z`);
    expect(aggregateWhere.issuedAt.lte.toISOString()).toBe(`${CLOSABLE_YEAR}-12-31T23:59:59.999Z`);

    expect(closing).toMatchObject({
      organizationId: "org-1",
      year: CLOSABLE_YEAR,
      lastInvoiceNumber: `FG-${CLOSABLE_YEAR}-000412`,
      lastInvoiceHash: "deadbeef",
      totalHt: 91_000_000_00n,
      totalTtc: 107_380_000_00n,
      invoiceCount: 412,
      closedByUserId: "user-1",
    });
    expect(closing.sealHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("clôture un exercice sans aucune facture — totaux 0, lastInvoice* null", async () => {
    const prisma = fakePrisma({
      aggregate: { _sum: { totalHt: null, totalTva: null, totalTtc: null }, _count: 0 },
      lastInvoice: null,
    });
    const service = new FiscalPeriodsService(prisma as never, fakeEtaxSync() as never);

    const closing = await service.close("org-1", CLOSABLE_YEAR, "user-1");

    expect(closing).toMatchObject({
      totalHt: 0n,
      totalTva: 0n,
      totalTtc: 0n,
      invoiceCount: 0,
      lastInvoiceNumber: null,
      lastInvoiceHash: null,
    });
  });

  it("double clôture (contrainte unique) -> ConflictException explicite", async () => {
    const p2002 = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["organization_id", "year"] },
    });
    const prisma = fakePrisma({
      createImpl: () => Promise.reject(p2002),
    });
    const service = new FiscalPeriodsService(prisma as never, fakeEtaxSync() as never);

    await expect(service.close("org-1", CLOSABLE_YEAR, "user-1")).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("FiscalPeriodsService.listByOrganization", () => {
  it("liste les clôtures de l'organisation, plus récent exercice d'abord", async () => {
    const prisma = fakePrisma({ closings: [{ year: 2026 }, { year: 2025 }] });
    const service = new FiscalPeriodsService(prisma as never, fakeEtaxSync() as never);

    const result = await service.listByOrganization("org-1");

    expect(prisma.fiscalPeriodClosing.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { year: "desc" },
    });
    expect(result).toEqual([{ year: 2026 }, { year: 2025 }]);
  });
});
