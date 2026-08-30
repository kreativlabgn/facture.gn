import { afterEach, describe, expect, it, vi } from "vitest";

import { RetentionModule } from "./retention.module";

const SAVED = process.env.RETENTION_ENABLED;

afterEach(() => {
  if (SAVED === undefined) delete process.env.RETENTION_ENABLED;
  else process.env.RETENTION_ENABLED = SAVED;
});

function build(upsertJobScheduler = vi.fn().mockResolvedValue(undefined)) {
  const queue = { upsertJobScheduler } as never;
  return { module: new RetentionModule(queue), upsertJobScheduler };
}

describe("RetentionModule.onModuleInit", () => {
  it("n'arme pas le scheduler quand RETENTION_ENABLED=false", async () => {
    process.env.RETENTION_ENABLED = "false";
    const { module, upsertJobScheduler } = build();

    await module.onModuleInit();

    expect(upsertJobScheduler).not.toHaveBeenCalled();
  });

  it("arme un job répétable quotidien quand la rétention est active", async () => {
    delete process.env.RETENTION_ENABLED;
    const { module, upsertJobScheduler } = build();

    await module.onModuleInit();

    expect(upsertJobScheduler).toHaveBeenCalledOnce();
    const [schedulerId, repeat] = upsertJobScheduler.mock.calls[0];
    expect(schedulerId).toBe("retention-daily");
    expect(repeat).toHaveProperty("every");
  });

  it("ne rejette pas si l'armement échoue (Redis KO) — le démarrage n'est jamais bloqué", async () => {
    delete process.env.RETENTION_ENABLED;
    const { module } = build(vi.fn().mockRejectedValue(new Error("Redis indisponible")));

    await expect(module.onModuleInit()).resolves.toBeUndefined();
  });
});
