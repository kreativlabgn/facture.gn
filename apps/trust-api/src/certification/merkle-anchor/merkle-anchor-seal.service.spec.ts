import { describe, expect, it, vi } from "vitest";

import { buildMerkleRoot } from "./merkle";
import { MerkleAnchorSealService } from "./merkle-anchor-seal.service";

const NOW = new Date("2026-08-30T14:30:00.000Z"); // heure courante = 14h → borne 14:00, tranche 13:00
const H = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

function build(
  overrides: {
    invoices?: { id: string; hash: string }[];
    lastBatchRoot?: string | null;
    createImpl?: (args: any) => Promise<any>;
  } = {},
) {
  const invoices = overrides.invoices ?? [
    { id: "inv-b", hash: H(2) },
    { id: "inv-a", hash: H(1) },
    { id: "inv-c", hash: H(3) },
  ];
  const prisma: any = {
    invoice: {
      findMany: vi.fn().mockResolvedValue([...invoices].sort((a, b) => a.hash.localeCompare(b.hash))),
      updateMany: vi.fn().mockResolvedValue({ count: invoices.length }),
    },
    merkleAnchorBatch: {
      findFirst: vi.fn().mockResolvedValue(
        overrides.lastBatchRoot === undefined ? null : { merkleRoot: overrides.lastBatchRoot },
      ),
      create:
        overrides.createImpl ??
        vi.fn(({ data }: any) => Promise.resolve({ id: "batch-1", hourStart: data.hourStart, ...data })),
    },
  };
  prisma.$transaction = vi.fn((cb: any) => cb(prisma));
  const sealed = { inc: vi.fn() };
  const anchored = { inc: vi.fn() };
  const service = new MerkleAnchorSealService(prisma as any, sealed as any, anchored as any);
  return { service, prisma, sealed, anchored };
}

describe("MerkleAnchorSealService.sealDue", () => {
  it("scelle une tranche : racine = buildMerkleRoot des hashes triés, hourStart = heure précédente", async () => {
    const { service, prisma } = build();

    const summary = await service.sealDue(NOW);

    expect(summary.batchCreated).toBe(true);
    expect(summary.leafCount).toBe(3);
    const createArgs = prisma.merkleAnchorBatch.create.mock.calls[0][0].data;
    expect(createArgs.hourStart.toISOString()).toBe("2026-08-30T13:00:00.000Z");
    expect(createArgs.merkleRoot).toBe(buildMerkleRoot([H(1), H(2), H(3)]));
    expect(createArgs.previousRoot).toBe("GENESIS");
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hash: { not: null }, anchorBatchId: null, issuedAt: { lt: new Date("2026-08-30T14:00:00.000Z") } },
        orderBy: { hash: "asc" },
      }),
    );
  });

  it("chaîne previousRoot sur la dernière tranche", async () => {
    const { service, prisma } = build({ lastBatchRoot: "abc123" });
    await service.sealDue(NOW);
    expect(prisma.merkleAnchorBatch.create.mock.calls[0][0].data.previousRoot).toBe("abc123");
  });

  it("assigne anchorBatchId aux factures, avec la garde anchorBatchId: null (idempotence)", async () => {
    const { service, prisma } = build();
    await service.sealDue(NOW);
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["inv-a", "inv-b", "inv-c"] }, anchorBatchId: null },
      data: { anchorBatchId: "batch-1" },
    });
  });

  it("aucune facture non ancrée → skipped: empty, pas de tranche", async () => {
    const { service, prisma, sealed } = build({ invoices: [] });
    prisma.invoice.findMany.mockResolvedValue([]);

    const summary = await service.sealDue(NOW);

    expect(summary).toMatchObject({ batchCreated: false, skipped: "empty" });
    expect(prisma.merkleAnchorBatch.create).not.toHaveBeenCalled();
    expect(sealed.inc).not.toHaveBeenCalled();
  });

  it("course : create échoue avec P2002 (hour_start) → skipped: already-sealed, pas de rejet", async () => {
    const { service } = build({
      createImpl: vi.fn().mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" })),
    });

    const summary = await service.sealDue(NOW);

    expect(summary).toMatchObject({ batchCreated: false, skipped: "already-sealed" });
  });

  it("incrémente les compteurs (tranches scellées, factures ancrées)", async () => {
    const { service, sealed, anchored } = build();
    await service.sealDue(NOW);
    expect(sealed.inc).toHaveBeenCalledOnce();
    expect(anchored.inc).toHaveBeenCalledWith(3);
  });
});
