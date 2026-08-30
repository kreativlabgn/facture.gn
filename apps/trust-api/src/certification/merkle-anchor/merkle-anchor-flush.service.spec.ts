import { describe, expect, it, vi } from "vitest";

import { NoopAnchorSink, type AnchorSink } from "./anchor-sink";
import { MerkleAnchorFlushService } from "./merkle-anchor-flush.service";

function build(
  sink: AnchorSink,
  pending: { id: string; merkleRoot: string }[],
  pendingTotalAfter = 0,
) {
  const prisma: any = {
    merkleAnchorBatch: {
      findMany: vi.fn().mockResolvedValue(pending),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(pendingTotalAfter),
    },
  };
  const errors = { inc: vi.fn() };
  const pendingGauge = { set: vi.fn() };
  const service = new MerkleAnchorFlushService(prisma as any, sink, errors as any, pendingGauge as any);
  return { service, prisma, errors, pendingGauge };
}

describe("MerkleAnchorFlushService.flushPending", () => {
  it("NoopAnchorSink : les tranches restent pending, anchor_attempts s'incrémente, pas de bascule anchored", async () => {
    const { service, prisma } = build(new NoopAnchorSink(), [
      { id: "b1", merkleRoot: "r1" },
      { id: "b2", merkleRoot: "r2" },
    ]);

    const summary = await service.flushPending();

    expect(summary).toMatchObject({ checked: 2, anchored: 0, stillPending: 2, errored: [] });
    expect(prisma.merkleAnchorBatch.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { anchorAttempts: { increment: 1 } },
    });
    expect(prisma.merkleAnchorBatch.update).toHaveBeenCalledTimes(2);
  });

  it("sink renvoyant un receipt : la tranche passe à anchored avec proof/ref/anchoredAt + anchor_attempts", async () => {
    const anchoredAt = new Date("2026-08-30T15:00:00.000Z");
    const sink: AnchorSink = {
      name: "test",
      anchor: vi.fn().mockResolvedValue({ proof: "PROOF", ref: "txid:abc", anchoredAt }),
    };
    const { service, prisma } = build(sink, [{ id: "b1", merkleRoot: "r1" }]);

    const summary = await service.flushPending();

    expect(summary).toMatchObject({ anchored: 1, stillPending: 0 });
    expect(prisma.merkleAnchorBatch.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: {
        anchorStatus: "anchored",
        anchorProof: "PROOF",
        anchorRef: "txid:abc",
        anchoredAt,
        anchorAttempts: { increment: 1 },
      },
    });
    expect(sink.anchor).toHaveBeenCalledWith("r1", "b1");
  });

  it("sink qui lève : tranche inchangée, compteur d'erreurs, pas de rejet, tranche suivante traitée", async () => {
    const sink: AnchorSink = {
      name: "flaky",
      anchor: vi
        .fn()
        .mockRejectedValueOnce(new Error("réseau"))
        .mockResolvedValueOnce({ proof: "P", ref: "r", anchoredAt: new Date() }),
    };
    const { service, prisma, errors } = build(sink, [
      { id: "b1", merkleRoot: "r1" },
      { id: "b2", merkleRoot: "r2" },
    ]);

    const summary = await service.flushPending();

    expect(summary).toMatchObject({ checked: 2, anchored: 1, errored: ["b1"] });
    expect(errors.inc).toHaveBeenCalledWith({ sink: "flaky" });
    expect(prisma.merkleAnchorBatch.update).toHaveBeenCalledTimes(1); // seulement b2
  });

  it("recalcule pendingTotal en fin de passage et le publie sur la gauge", async () => {
    const { service, prisma, pendingGauge } = build(new NoopAnchorSink(), [{ id: "b1", merkleRoot: "r1" }], 4);

    const summary = await service.flushPending();

    expect(summary.pendingTotal).toBe(4);
    expect(prisma.merkleAnchorBatch.count).toHaveBeenCalledWith({ where: { anchorStatus: "pending" } });
    expect(pendingGauge.set).toHaveBeenCalledWith(4);
  });

  it("respecte la limite et l'ordre (asOf asc)", async () => {
    const { service, prisma } = build(new NoopAnchorSink(), []);
    await service.flushPending(7);
    expect(prisma.merkleAnchorBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { anchorStatus: "pending" }, orderBy: { asOf: "asc" }, take: 7 }),
    );
  });
});
