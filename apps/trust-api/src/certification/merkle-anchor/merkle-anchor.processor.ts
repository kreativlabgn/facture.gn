import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";

import { MerkleAnchorFlushService, type FlushSummary } from "./merkle-anchor-flush.service";
import { MerkleAnchorSealService, type SealSummary } from "./merkle-anchor-seal.service";

export const MERKLE_SEAL_QUEUE = "merkle-anchor-seal";
export const MERKLE_FLUSH_QUEUE = "merkle-anchor-flush";

// Lot E1 — wrappers minces : la logique vit dans les services (testables sans
// BullMQ).

@Processor(MERKLE_SEAL_QUEUE)
export class MerkleAnchorSealProcessor extends WorkerHost {
  private readonly logger = new Logger(MerkleAnchorSealProcessor.name);

  constructor(private readonly sealService: MerkleAnchorSealService) {
    super();
  }

  async process(): Promise<SealSummary> {
    const summary = await this.sealService.sealDue();
    this.logger.log(`Scellement Merkle : ${JSON.stringify(summary)}`);
    return summary;
  }
}

@Processor(MERKLE_FLUSH_QUEUE)
export class MerkleAnchorFlushProcessor extends WorkerHost {
  private readonly logger = new Logger(MerkleAnchorFlushProcessor.name);

  constructor(private readonly flushService: MerkleAnchorFlushService) {
    super();
  }

  async process(): Promise<FlushSummary> {
    const summary = await this.flushService.flushPending();
    const message = `Flush d'ancrage Merkle : ${JSON.stringify(summary)}`;
    if (summary.checked > 0 && summary.errored.length === summary.checked) {
      // Aucune tranche traitée avec succès : sink globalement KO → job "failed".
      throw new Error(`Flush d'ancrage : toutes les tranches ont échoué (${summary.errored.join(", ")})`);
    }
    if (summary.errored.length > 0) {
      this.logger.warn(`${message} — tranches en échec : ${summary.errored.join(", ")}`);
    } else {
      this.logger.log(message);
    }
    return summary;
  }
}
