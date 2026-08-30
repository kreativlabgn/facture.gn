import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";

import { RetentionService, type RetentionSummary } from "./retention.service";

export const RETENTION_QUEUE = "retention";

// Lot J3 — wrapper mince : la logique vit dans RetentionService (testable sans
// BullMQ). Le processeur déclenche, journalise selon la gravité, et FAIT ÉCHOUER
// le job si toutes les tables ont échoué (panne globale = le job ne doit pas se
// dire "completed").
@Processor(RETENTION_QUEUE)
export class RetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(RetentionProcessor.name);

  constructor(private readonly retentionService: RetentionService) {
    super();
  }

  async process(): Promise<RetentionSummary> {
    const summary = await this.retentionService.runOnce();
    const message = `Purge de rétention : ${JSON.stringify(summary)}`;

    if (summary.ruleCount > 0 && summary.errored.length === summary.ruleCount) {
      // Aucune table purgée : panne globale (DB down). Le job doit être marqué
      // "failed" côté BullMQ, pas "completed".
      throw new Error(`Purge de rétention : toutes les tables ont échoué (${summary.errored.join(", ")})`);
    }
    if (summary.errored.length > 0) {
      this.logger.warn(`${message} — tables en échec : ${summary.errored.join(", ")}`);
    } else {
      this.logger.log(message);
    }

    return summary;
  }
}
