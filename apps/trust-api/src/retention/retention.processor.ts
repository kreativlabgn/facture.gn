import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";

import { RetentionService, type RetentionSummary } from "./retention.service";

export const RETENTION_QUEUE = "retention";

// Lot J3 — wrapper mince : la logique vit dans RetentionService (testable sans
// BullMQ). Le processeur ne fait que déclencher et journaliser.
@Processor(RETENTION_QUEUE)
export class RetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(RetentionProcessor.name);

  constructor(private readonly retentionService: RetentionService) {
    super();
  }

  async process(): Promise<RetentionSummary> {
    const summary = await this.retentionService.runOnce();
    this.logger.log(`Purge de rétention : ${JSON.stringify(summary)}`);
    return summary;
  }
}
