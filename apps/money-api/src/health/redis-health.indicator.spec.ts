import { HealthIndicatorService } from "@nestjs/terminus";
import { describe, expect, it, vi } from "vitest";
import { RedisHealthIndicator } from "./redis-health.indicator";

// HealthIndicatorService réel (léger, pas de mock) — c'est lui qui met en forme
// up()/down(). On ne mocke que la connexion Redis.
function build(clientImpl: unknown) {
  const queue = { client: Promise.resolve(clientImpl) };
  return new RedisHealthIndicator(new HealthIndicatorService(), queue as never);
}

describe("RedisHealthIndicator", () => {
  it("up quand PING répond PONG", async () => {
    const indicator = build({ ping: vi.fn().mockResolvedValue("PONG") });
    const result = await indicator.isHealthy("redis");
    expect(result.redis.status).toBe("up");
  });

  it("down quand PING rejette", async () => {
    const indicator = build({ ping: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) });
    const result = await indicator.isHealthy("redis");
    expect(result.redis.status).toBe("down");
    expect(String(result.redis.message)).toMatch(/ECONNREFUSED/);
  });

  it("down quand PING dépasse le délai", async () => {
    const indicator = build({ ping: vi.fn(() => new Promise(() => {})) }); // ne résout jamais
    const result = await indicator.isHealthy("redis");
    expect(result.redis.status).toBe("down");
    expect(String(result.redis.message)).toMatch(/délai|timeout/i);
  });
});
