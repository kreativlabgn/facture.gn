import { describe, expect, it, vi } from "vitest";
import { HealthController } from "./health.controller";

describe("HealthController (trust-api)", () => {
  it("live() renvoie ok sans aucun appel d'infrastructure", () => {
    const health = { check: vi.fn() };
    const prisma = { pingCheck: vi.fn() };
    const controller = new HealthController(health as never, prisma as never, {} as never);

    expect(controller.live()).toEqual({ status: "ok" });
    expect(health.check).not.toHaveBeenCalled();
    expect(prisma.pingCheck).not.toHaveBeenCalled();
  });

  it("ready() délègue au HealthCheckService avec le ping Postgres", async () => {
    const health = { check: vi.fn().mockResolvedValue({ status: "ok" }) };
    const prisma = { pingCheck: vi.fn().mockResolvedValue({ database: { status: "up" } }) };
    const controller = new HealthController(health as never, prisma as never, {} as never);

    await controller.ready();

    expect(health.check).toHaveBeenCalledOnce();
    // le HealthCheckService reçoit un tableau d'une fonction ; on l'exécute
    const indicators = health.check.mock.calls[0][0] as Array<() => unknown>;
    indicators.forEach((fn) => fn());
    expect(prisma.pingCheck).toHaveBeenCalledWith("database", expect.anything());
  });
});
