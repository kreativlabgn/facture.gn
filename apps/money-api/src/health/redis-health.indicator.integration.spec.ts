import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { HealthIndicatorService } from "@nestjs/terminus";
import { Queue, RedisConnection, type QueueOptions } from "bullmq";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildRedisConnection } from "../queue/queue.config";
import { RedisHealthIndicator } from "./redis-health.indicator";

// Sonde Redis contre la VRAIE API BullMQ (plan 2026-10-01-startup-secrets-and-
// redis-health). Le spec unitaire fabrique la file ; celui-ci n'invente rien :
// c'est lui qui aurait vu BullMQ 6 retirer `queue.client`.
//
// Deux niveaux, comme les specs Postgres du dépôt :
//   - la forme de l'API et le cas « Redis injoignable » ne demandent AUCUN
//     serveur : ils tournent toujours, CI comprise ;
//   - le cas « Redis sain » exige un Redis joignable sur REDIS_URL (le service
//     redis:7 de la CI le fournit) et se dérobe sinon. Sonde TCP et non
//     `Boolean(process.env.REDIS_URL)` : la variable est définie même sans
//     serveur en face.
const PORT_FERME = { url: "redis://127.0.0.1:1", maxRetriesPerRequest: null, lazyConnect: true } as const;

let redisJoignable = false;
const files: Queue[] = [];

function creerFile(options: QueueOptions): Queue {
  const file = new Queue(`health-it-${randomUUID()}`, options);
  // Une file pointée sur un port fermé émet des erreurs de connexion : sans
  // écouteur, EventEmitter les relancerait et ferait tomber le runner.
  file.on("error", () => {});
  files.push(file);
  return file;
}

function sondeTcp(urlRedis: string): Promise<boolean> {
  const { hostname, port } = new URL(urlRedis);
  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port || 6379) });
    const fin = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000, () => fin(false));
    socket.once("connect", () => fin(true));
    socket.once("error", () => fin(false));
  });
}

describe("RedisHealthIndicator — vraie file BullMQ", () => {
  beforeAll(async () => {
    redisJoignable = await sondeTcp(buildRedisConnection().url);
  });

  afterEach(async () => {
    while (files.length > 0) {
      const file = files.pop() as Queue;
      await Promise.race([file.close(), new Promise((r) => setTimeout(r, 1000))]).catch(() => {});
      await file.disconnect().catch(() => {});
    }
  });

  it("la file BullMQ expose backend.connection.client — la forme dont dépend la sonde", () => {
    // Descripteur statique : on n'évalue PAS le getter, qui déclencherait une
    // connexion (et une promesse rejetée non attendue sur un port fermé).
    expect(typeof Object.getOwnPropertyDescriptor(RedisConnection.prototype, "client")?.get).toBe("function");

    const file = creerFile({ connection: PORT_FERME });
    expect(file.backend).toHaveProperty("connection");
  });

  it("down, et borné dans le temps, quand Redis est injoignable", async () => {
    const indicator = new RedisHealthIndicator(
      new HealthIndicatorService(),
      creerFile({ connection: PORT_FERME }) as never,
    );

    const debut = Date.now();
    const result = await indicator.isHealthy("redis");

    expect(result.redis.status).toBe("down");
    // Délai de la sonde : 2 s. Marge pour une machine chargée, mais bien en deçà
    // du « pend indéfiniment » d'origine.
    expect(Date.now() - debut).toBeLessThan(4000);
  }, 8000);

  it("up sur un Redis sain, avec une vraie file BullMQ", async (contexte) => {
    if (!redisJoignable) {
      contexte.skip();
    }

    const indicator = new RedisHealthIndicator(
      new HealthIndicatorService(),
      creerFile({ connection: buildRedisConnection() }) as never,
    );

    const result = await indicator.isHealthy("redis");

    expect(result.redis.status).toBe("up");
  }, 8000);
});
