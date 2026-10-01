import { HealthIndicatorService } from "@nestjs/terminus";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RedisHealthIndicator } from "./redis-health.indicator";

// HealthIndicatorService réel (léger, pas de mock) — c'est lui qui met en forme
// up()/down(). On ne mocke que la connexion Redis.
//
// FORME DE LA FILE. BullMQ 6 n'expose plus `queue.client` : le client brut est
// `queue.backend.connection.client` (Promise<IRedisClient>), et `toKey` donne la
// clé de sonde dans l'espace de noms de la file. Ce spec fabriquait auparavant
// `{ client: … }` — la forme que le code lisait, pas celle de BullMQ — et n'a donc
// rien vu quand BullMQ a changé : /health/ready répondait 503 sur un Redis sain.
// La forme réelle est exercée de bout en bout, sans doublure, par
// redis-health.indicator.integration.spec.ts.
function build(client: Promise<unknown>) {
  const queue = {
    backend: { connection: { client } },
    toKey: (type: string) => `bull:reconciliation:${type}`,
  };
  return new RedisHealthIndicator(new HealthIndicatorService(), queue as never);
}

describe("RedisHealthIndicator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("up quand la lecture de sonde répond", async () => {
    const get = vi.fn().mockResolvedValue(null);
    const indicator = build(Promise.resolve({ get }));
    const result = await indicator.isHealthy("redis");
    expect(result.redis.status).toBe("up");
    // Lecture d'une clé de sonde dans l'espace de noms de la file, jamais une écriture.
    expect(get).toHaveBeenCalledWith("bull:reconciliation:health-probe");
  });

  it("down quand la commande rejette", async () => {
    const indicator = build(Promise.resolve({ get: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) }));
    const result = await indicator.isHealthy("redis");
    expect(result.redis.status).toBe("down");
    expect(String(result.redis.message)).toMatch(/ECONNREFUSED/);
  });

  it("down quand l'obtention du client échoue (connexion refusée à l'initialisation)", async () => {
    const indicator = build(Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:6379")));
    const result = await indicator.isHealthy("redis");
    expect(result.redis.status).toBe("down");
    expect(String(result.redis.message)).toMatch(/ECONNREFUSED/);
  });

  it("down quand la commande dépasse le délai", async () => {
    vi.useFakeTimers();
    const indicator = build(Promise.resolve({ get: vi.fn(() => new Promise(() => {})) })); // ne résout jamais
    const pending = indicator.isHealthy("redis");
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;
    expect(result.redis.status).toBe("down");
    expect(String(result.redis.message)).toMatch(/délai|timeout/i);
  });

  // Le trou d'origine : `await client` était HORS du délai. Redis injoignable au
  // démarrage = la promesse du client ne se résout pas, et /health/ready pendait
  // au lieu de répondre 503.
  it("down dans le délai quand l'obtention du client ne se résout jamais", async () => {
    vi.useFakeTimers();
    const indicator = build(new Promise(() => {})); // le client n'arrive jamais
    const pending = indicator.isHealthy("redis");
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;
    expect(result.redis.status).toBe("down");
    expect(String(result.redis.message)).toMatch(/délai|timeout/i);
  });

  it("ne laisse aucun minuteur en suspens après une sonde réussie", async () => {
    vi.useFakeTimers();
    const indicator = build(Promise.resolve({ get: vi.fn().mockResolvedValue(null) }));
    await indicator.isHealthy("redis");
    expect(vi.getTimerCount()).toBe(0);
  });
});
