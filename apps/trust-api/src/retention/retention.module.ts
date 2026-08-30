import { BullModule, InjectQueue } from "@nestjs/bullmq";
import { Logger, Module, type OnModuleInit } from "@nestjs/common";
import { makeCounterProvider } from "@willsoto/nestjs-prometheus";
import type { Queue } from "bullmq";

import { RETENTION_INTERVAL_MS } from "./retention.constants";
import { RETENTION_DELETED_METRIC } from "./retention.metrics";
import { RETENTION_QUEUE, RetentionProcessor } from "./retention.processor";
import { RetentionService } from "./retention.service";

const SCHEDULER_ID = "retention-daily";

// Lot J3 — purge des tables opérationnelles éphémères. Même pattern que
// ReconciliationModule (money-api, Lot E) : file BullMQ + job répétable armé
// dans onModuleInit, jamais bloquant au démarrage.
@Module({
  imports: [BullModule.registerQueue({ name: RETENTION_QUEUE })],
  providers: [
    RetentionService,
    RetentionProcessor,
    makeCounterProvider({
      name: RETENTION_DELETED_METRIC,
      help: "Nombre de lignes supprimées par la rétention, cumulé par table",
      labelNames: ["table"],
    }),
  ],
})
export class RetentionModule implements OnModuleInit {
  private readonly logger = new Logger(RetentionModule.name);

  constructor(@InjectQueue(RETENTION_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    // RETENTION_ENABLED=false : garder la brique BullMQ sans lancer le job
    // (déploiement progressif, environnement de test/CI).
    if (process.env.RETENTION_ENABLED === "false") {
      this.logger.warn("Job de rétention désactivé (RETENTION_ENABLED=false)");
      return;
    }
    // upsert : jobId de scheduler stable → un seul job répétable quel que soit
    // le nombre de redémarrages / d'instances. Un échec (Redis indisponible au
    // démarrage) ne doit JAMAIS empêcher trust-api de démarrer — la rétention
    // est un travail d'hygiène, jamais un chemin critique.
    try {
      await this.queue.upsertJobScheduler(SCHEDULER_ID, { every: RETENTION_INTERVAL_MS }, { name: "run" });
      this.logger.log(`Job de rétention actif (toutes les ${RETENTION_INTERVAL_MS / 3_600_000} h)`);
    } catch (error) {
      this.logger.error(
        `Échec de l'armement du job de rétention (Redis ?) — trust-api démarre quand même : ${(error as Error).message}`,
      );
    }
  }
}
