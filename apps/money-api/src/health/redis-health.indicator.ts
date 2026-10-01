import { Injectable } from "@nestjs/common";
import { HealthIndicatorService, type HealthIndicatorResult } from "@nestjs/terminus";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue, RedisQueueBackend } from "bullmq";
import { RECONCILIATION_QUEUE } from "../reconciliation/reconciliation.processor";

const PING_TIMEOUT_MS = 2000;

// Lot F — état de Redis via un aller-retour sur la connexion de la file BullMQ
// (pas une seconde connexion dédiée). Timeout court : /health/ready ne doit
// jamais pendre si Redis est injoignable.
//
// ACCÈS TYPÉ, PAS CASTÉ. BullMQ 6 a retiré `queue.client` : le client brut vit
// sur le backend Redis de la file (`queue.backend.connection.client`). L'ancienne
// version passait par un double cast `as unknown as { client: … }` qui désactive
// le compilateur : quand BullMQ a changé, ni `tsc` ni les tests n'ont rien vu, et
// /health/ready a répondu 503 sur un Redis sain. Ici, `Queue.backend` est
// rétréci vers `RedisQueueBackend` (cast ordinaire, vérifié) puis lu par ses
// membres publics : un futur changement de BullMQ casse le build, pas la prod.
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @InjectQueue(RECONCILIATION_QUEUE) private readonly queue: Queue,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await withTimeout(this.ping(), PING_TIMEOUT_MS);
      return indicator.up();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return indicator.down({ message });
    }
  }

  // Obtention du client ET aller-retour sous le MÊME délai : Redis injoignable au
  // démarrage laisse la promesse du client en attente, et un `await client` hors
  // délai ferait pendre /health/ready au lieu de répondre 503.
  //
  // L'aller-retour est une LECTURE d'une clé de sonde absente, pas un PING : le
  // client de BullMQ 6 est une interface neutre (ioredis, node-redis, Bun) qui ne
  // déclare que « les commandes que BullMQ utilise » — `ping` n'en fait pas
  // partie, et `tsc` le refuse. `get` y figure, ne modifie rien, et prouve comme
  // un PING que la connexion répond et exécute des commandes.
  private async ping(): Promise<void> {
    const { connection } = this.queue.backend as RedisQueueBackend;
    const client = await connection.client;
    await client.get(this.queue.toKey("health-probe"));
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<never>((_, reject) => {
    minuteur = setTimeout(() => reject(new Error(`Sonde Redis : délai dépassé (${ms} ms)`)), ms);
  });
  // Le minuteur est libéré dans tous les cas : sans cela, un PING réussi laisse
  // un setTimeout de 2 s en suspens (et retient le processus à l'arrêt).
  return Promise.race([promise, delai]).finally(() => clearTimeout(minuteur));
}
