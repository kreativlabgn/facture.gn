import { describe, expect, it, vi } from "vitest";

import { NoopAnchorSink, type AnchorSink } from "./anchor-sink";
import { MerkleAnchorFlushService } from "./merkle-anchor-flush.service";

function build(sink: AnchorSink, pending: { id: string; merkleRoot: string }[]) {
  const prisma: any = {
    merkleAnchorBatch: {
      findMany: vi.fn().mockResolvedValue(pending),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const errors = { inc: vi.fn() };
  const service = new MerkleAnchorFlushService(prisma as any, sink, errors as any);
  return { service, prisma, errors };
}

describe("MerkleAnchorFlushService.flushPending", () => {
  it("NoopAnchorSink : les tranches restent pending, aucun update", async () => {
    const { service, prisma } = build(new NoopAnchorSink(), [
      { id: "b1", merkleRoot: "r1" },
      { id: "b2", merkleRoot: "r2" },
    ]);

    const summary = await service.flushPending();

    expect(summary).toMatchObject({ checked: 2, anchored: 0, stillPending: 2, errored: [] });
    expect(prisma.merkleAnchorBatch.update).not.toHaveBeenCalled();
  });

  it("sink renvoyant un receipt : la tranche passe à anchored avec proof/ref/anchoredAt", async () => {
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
      data: { anchorStatus: "anchored", anchorProof: "PROOF", anchorRef: "txid:abc", anchoredAt },
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

  it("respecte la limite et l'ordre (hourStart asc)", async () => {
    const { service, prisma } = build(new NoopAnchorSink(), []);
    await service.flushPending(7);
    expect(prisma.merkleAnchorBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { anchorStatus: "pending" }, orderBy: { hourStart: "asc" }, take: 7 }),
    );
  });
});
