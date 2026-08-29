import { describe, expect, it, vi } from "vitest";
import { HealthController } from "./health.controller";

describe("HealthController (money-api)", () => {
  it("live() renvoie ok sans aucun appel d'infrastructure", () => {
    const health = { check: vi.fn() };
    const controller = new HealthController(health as never, { pingCheck: vi.fn() } as never, { isHealthy: vi.fn() } as never, {} as never);

    expect(controller.live()).toEqual({ status: "ok" });
    expect(health.check).not.toHaveBeenCalled();
  });

  it("ready() vérifie Postgres ET Redis", async () => {
    const health = { check: vi.fn().mockResolvedValue({ status: "ok" }) };
    const prisma = { pingCheck: vi.fn().mockResolvedValue({}) };
    const redis = { isHealthy: vi.fn().mockResolvedValue({}) };
    const controller = new HealthController(health as never, prisma as never, redis as never, {} as never);

    await controller.ready();

    const indicators = health.check.mock.calls[0][0] as Array<() => unknown>;
    indicators.forEach((fn) => fn());
    expect(prisma.pingCheck).toHaveBeenCalledWith("database", expect.anything());
    expect(redis.isHealthy).toHaveBeenCalledWith("redis");
  });
});
