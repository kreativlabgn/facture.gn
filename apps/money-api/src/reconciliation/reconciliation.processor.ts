import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { ReconciliationService, type ReconciliationSummary } from "./reconciliation.service";

export const RECONCILIATION_QUEUE = "reconciliation";

// Lot E — wrapper mince : la logique vit dans ReconciliationService (testable
// sans BullMQ). Le processeur ne fait que déclencher et journaliser.
@Processor(RECONCILIATION_QUEUE)
export class ReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReconciliationProcessor.name);

  constructor(private readonly reconciliationService: ReconciliationService) {
    super();
  }

  async process(): Promise<ReconciliationSummary> {
    const summary = await this.reconciliationService.runOnce();
    this.logger.log(`Réconciliation des paiements : ${JSON.stringify(summary)}`);
    return summary;
  }
}
