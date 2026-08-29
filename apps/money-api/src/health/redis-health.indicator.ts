import { Injectable } from "@nestjs/common";
import { HealthIndicatorService, type HealthIndicatorResult } from "@nestjs/terminus";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { RECONCILIATION_QUEUE } from "../reconciliation/reconciliation.processor";

// bullmq expose `client` (Promise<ioredis>) sur QueueBase depuis la v3, mais le
// getter est `protected` dans les types publics — surface minimale typée
// localement plutôt qu'une seconde connexion Redis dédiée au health check.
type QueueWithClient = { client: Promise<{ ping(): Promise<string> }> };

const PING_TIMEOUT_MS = 2000;

// Lot F — état de Redis via un PING sur la connexion ioredis de la file BullMQ
// (pas une seconde connexion dédiée). Timeout court : /health/ready ne doit
// jamais pendre si Redis est injoignable.
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @InjectQueue(RECONCILIATION_QUEUE) private readonly queue: Queue,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const client = await (this.queue as unknown as QueueWithClient).client;
      await withTimeout(client.ping(), PING_TIMEOUT_MS);
      return indicator.up();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return indicator.down({ message });
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`PING Redis : délai dépassé (${ms} ms)`)), ms)),
  ]);
}
