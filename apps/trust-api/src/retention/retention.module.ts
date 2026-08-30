import { BullModule, InjectQueue } from "@nestjs/bullmq";
import { Logger, Module, type OnModuleInit } from "@nestjs/common";
import { InjectMetric, makeCounterProvider, makeGaugeProvider } from "@willsoto/nestjs-prometheus";
import type { Queue } from "bullmq";
import type { Gauge } from "prom-client";

import { RETENTION_INTERVAL_MS } from "./retention.constants";
import {
  RETENTION_DELETED_METRIC,
  RETENTION_ERRORS_METRIC,
  RETENTION_SCHEDULER_ARMED_METRIC,
} from "./retention.metrics";
import { RETENTION_QUEUE, RetentionProcessor } from "./retention.processor";
import { RetentionService } from "./retention.service";

const SCHEDULER_ID = "retention-daily";

/** La purge est un DELETE physique irréversible : opt-in EXPLICITE (divergence
 *  assumée vs RECONCILIATION_ENABLED de money-api, qui est non-destructif). */
function retentionEnabled(): boolean {
  return (process.env.RETENTION_ENABLED ?? "").trim().toLowerCase() === "true";
}

// Lot J3 — purge des tables opérationnelles éphémères. Même pattern que
// ReconciliationModule (money-api, Lot E) : file BullMQ + job répétable armé
// dans onModuleInit, jamais bloquant au démarrage.
@Module({
  imports: [
    BullModule.registerQueue({
      name: RETENTION_QUEUE,
      // Job quotidien qui tourne des années : borner l'historique dans Redis.
      // attempts par défaut (1) assumé : deleteMany est idempotent, un échec
      // repasse au tick suivant.
      defaultJobOptions: { removeOnComplete: 50, removeOnFail: 200 },
    }),
  ],
  providers: [
    RetentionService,
    RetentionProcessor,
    makeCounterProvider({
      name: RETENTION_DELETED_METRIC,
      help: "Nombre de lignes supprimées par la rétention, cumulé par table",
      labelNames: ["table"],
    }),
    makeCounterProvider({
      name: RETENTION_ERRORS_METRIC,
      help: "Nombre d'échecs de purge, cumulé par table",
      labelNames: ["table"],
    }),
    makeGaugeProvider({
      name: RETENTION_SCHEDULER_ARMED_METRIC,
      help: "1 si le job de purge est planifié, 0 sinon",
    }),
  ],
})
export class RetentionModule implements OnModuleInit {
  private readonly logger = new Logger(RetentionModule.name);

  constructor(
    @InjectQueue(RETENTION_QUEUE) private readonly queue: Queue,
    @InjectMetric(RETENTION_SCHEDULER_ARMED_METRIC) private readonly armed: Gauge<string>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.armed.set(0);

    if (!retentionEnabled()) {
      this.logger.warn(
        'Job de rétention désactivé (RETENTION_ENABLED != "true"). Voir docs/runbooks/retention.md.',
      );
      return;
    }
    // upsert : jobId de scheduler stable → un seul job répétable quel que soit
    // le nombre de redémarrages / d'instances. Un échec (Redis indisponible au
    // démarrage) ne doit JAMAIS empêcher trust-api de démarrer — la rétention
    // est un travail d'hygiène, jamais un chemin critique. Le scheduler sera
    // réarmé au prochain redémarrage ; la gauge à 0 permet d'alerter d'ici là.
    try {
      await this.queue.upsertJobScheduler(SCHEDULER_ID, { every: RETENTION_INTERVAL_MS }, { name: "run" });
      this.armed.set(1);
      this.logger.log(`Job de rétention actif (toutes les ${RETENTION_INTERVAL_MS / 3_600_000} h)`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const code = (error as { code?: string }).code;
      this.logger.error(
        `Échec de l'armement du job de rétention${code ? ` [${code}]` : ""} — trust-api démarre quand même, le job ne tournera pas`,
        err.stack ?? err.message,
      );
    }
  }
}
