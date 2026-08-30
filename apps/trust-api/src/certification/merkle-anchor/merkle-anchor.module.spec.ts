import { afterEach, describe, expect, it, vi } from "vitest";

import { MerkleAnchorModule } from "./merkle-anchor.module";

const SAVED = process.env.MERKLE_ANCHOR_ENABLED;

afterEach(() => {
  if (SAVED === undefined) delete process.env.MERKLE_ANCHOR_ENABLED;
  else process.env.MERKLE_ANCHOR_ENABLED = SAVED;
});

function build(seal = vi.fn().mockResolvedValue(undefined), flush = vi.fn().mockResolvedValue(undefined)) {
  const armed = { set: vi.fn() };
  const module = new MerkleAnchorModule(
    { upsertJobScheduler: seal } as never,
    { upsertJobScheduler: flush } as never,
    armed as never,
  );
  return { module, seal, flush, armed };
}

describe("MerkleAnchorModule.onModuleInit", () => {
  it("n'arme rien tant que MERKLE_ANCHOR_ENABLED n'est pas \"true\"", async () => {
    for (const value of ["false", "", "1", undefined]) {
      if (value === undefined) delete process.env.MERKLE_ANCHOR_ENABLED;
      else process.env.MERKLE_ANCHOR_ENABLED = value;
      const { module, seal, flush, armed } = build();

      await module.onModuleInit();

      expect(seal).not.toHaveBeenCalled();
      expect(flush).not.toHaveBeenCalled();
      expect(armed.set).toHaveBeenLastCalledWith(0);
    }
  });

  it("arme les deux schedulers quand activé et pose la gauge à 1", async () => {
    process.env.MERKLE_ANCHOR_ENABLED = "  TRUE ";
    const { module, seal, flush, armed } = build();

    await module.onModuleInit();

    expect(seal).toHaveBeenCalledWith("merkle-anchor-seal-hourly", expect.objectContaining({ every: 3_600_000 }), { name: "run" });
    expect(flush).toHaveBeenCalledWith("merkle-anchor-flush-recurring", expect.any(Object), { name: "run" });
    expect(armed.set).toHaveBeenLastCalledWith(1);
  });

  it("ne rejette pas si l'armement échoue (Redis KO) — démarrage préservé, gauge à 0", async () => {
    process.env.MERKLE_ANCHOR_ENABLED = "true";
    const { module, armed } = build(vi.fn().mockRejectedValue(new Error("Redis KO")));

    await expect(module.onModuleInit()).resolves.toBeUndefined();
    expect(armed.set).toHaveBeenLastCalledWith(0);
  });
});
