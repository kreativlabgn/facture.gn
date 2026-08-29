import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { FiscalPeriodsService } from "./fiscal-periods.service";

const CURRENT_YEAR = new Date().getUTCFullYear();
const CLOSABLE_YEAR = CURRENT_YEAR - 1;

function fakePrisma(overrides: {
  aggregate?: unknown;
  lastInvoice?: unknown;
  createImpl?: (args: unknown) => unknown;
  closings?: unknown[];
} = {}) {
  const prisma = {
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
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  return prisma;
}

describe("FiscalPeriodsService.close", () => {
  it("refuse de clôturer une année future", async () => {
    const service = new FiscalPeriodsService(fakePrisma() as never);
    await expect(service.close("org-1", CURRENT_YEAR + 1, "user-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuse une année absurde (avant 2020)", async () => {
    const service = new FiscalPeriodsService(fakePrisma() as never);
    await expect(service.close("org-1", 1998, "user-1")).rejects.toBeInstanceOf(ConflictException);
    await expect(service.close("org-1", -5, "user-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("agrège les factures émises de l'année (bornes UTC) et le dernier numéro/hash", async () => {
    const prisma = fakePrisma();
    const service = new FiscalPeriodsService(prisma as never);

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
    const service = new FiscalPeriodsService(prisma as never);

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
    const service = new FiscalPeriodsService(prisma as never);

    await expect(service.close("org-1", CLOSABLE_YEAR, "user-1")).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("FiscalPeriodsService.listByOrganization", () => {
  it("liste les clôtures de l'organisation, plus récent exercice d'abord", async () => {
    const prisma = fakePrisma({ closings: [{ year: 2026 }, { year: 2025 }] });
    const service = new FiscalPeriodsService(prisma as never);

    const result = await service.listByOrganization("org-1");

    expect(prisma.fiscalPeriodClosing.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { year: "desc" },
    });
    expect(result).toEqual([{ year: 2026 }, { year: 2025 }]);
  });
});
