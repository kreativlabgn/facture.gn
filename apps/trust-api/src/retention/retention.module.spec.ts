import { afterEach, describe, expect, it, vi } from "vitest";

import { RetentionModule } from "./retention.module";

const SAVED = process.env.RETENTION_ENABLED;

afterEach(() => {
  if (SAVED === undefined) delete process.env.RETENTION_ENABLED;
  else process.env.RETENTION_ENABLED = SAVED;
});

function build(upsertJobScheduler = vi.fn().mockResolvedValue(undefined)) {
  const queue = { upsertJobScheduler } as never;
  const armed = { set: vi.fn() };
  return { module: new RetentionModule(queue, armed as never), upsertJobScheduler, armed };
}

describe("RetentionModule.onModuleInit", () => {
  it("n'arme pas le scheduler tant que RETENTION_ENABLED n'est pas \"true\" (opt-in, DELETE irréversible)", async () => {
    for (const value of ["false", "", "0", "yes", undefined]) {
      if (value === undefined) delete process.env.RETENTION_ENABLED;
      else process.env.RETENTION_ENABLED = value;
      const { module, upsertJobScheduler, armed } = build();

      await module.onModuleInit();

      expect(upsertJobScheduler).not.toHaveBeenCalled();
      expect(armed.set).toHaveBeenLastCalledWith(0);
    }
  });

  it("arme un job répétable quotidien quand RETENTION_ENABLED=\"true\" et pose la gauge à 1", async () => {
    process.env.RETENTION_ENABLED = "  TRUE  ";
    const { module, upsertJobScheduler, armed } = build();

    await module.onModuleInit();

    expect(upsertJobScheduler).toHaveBeenCalledOnce();
    const [schedulerId, repeat] = upsertJobScheduler.mock.calls[0];
    expect(schedulerId).toBe("retention-daily");
    expect(repeat).toHaveProperty("every");
    expect(armed.set).toHaveBeenLastCalledWith(1);
  });

  it("ne rejette pas si l'armement échoue (Redis KO) — démarrage préservé, gauge reste à 0", async () => {
    process.env.RETENTION_ENABLED = "true";
    const { module, armed } = build(vi.fn().mockRejectedValue(new Error("Redis indisponible")));

    await expect(module.onModuleInit()).resolves.toBeUndefined();
    expect(armed.set).toHaveBeenLastCalledWith(0);
  });
});
