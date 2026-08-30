import { afterEach, describe, expect, it } from "vitest";

import { buildRedisConnection } from "./queue.config";

afterEach(() => {
  delete process.env.REDIS_URL;
});

describe("buildRedisConnection (trust-api)", () => {
  it("utilise redis://localhost:6379 par défaut", () => {
    expect(buildRedisConnection().url).toBe("redis://localhost:6379");
  });

  it("respecte REDIS_URL", () => {
    process.env.REDIS_URL = "redis://cache.internal:6380/1";
    expect(buildRedisConnection().url).toBe("redis://cache.internal:6380/1");
  });

  it("maxRetriesPerRequest null (BullMQ l'exige) et lazyConnect true (le smoke DI compile sans Redis)", () => {
    const conn = buildRedisConnection();
    expect(conn.maxRetriesPerRequest).toBeNull();
    expect(conn.lazyConnect).toBe(true);
  });
});
