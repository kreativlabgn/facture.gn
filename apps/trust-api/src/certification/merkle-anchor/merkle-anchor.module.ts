import { BullModule, InjectQueue } from "@nestjs/bullmq";
import { Logger, Module, type OnModuleInit } from "@nestjs/common";
import { InjectMetric, makeCounterProvider, makeGaugeProvider } from "@willsoto/nestjs-prometheus";
import type { Queue } from "bullmq";
import type { Gauge } from "prom-client";

import { ANCHOR_SINK, NoopAnchorSink } from "./anchor-sink";
import { FLUSH_INTERVAL_MS, SEAL_INTERVAL_MS, merkleAnchorEnabled } from "./merkle-anchor.constants";
import { MerkleAnchorFlushService } from "./merkle-anchor-flush.service";
import {
  MERKLE_BATCHES_SEALED_METRIC,
  MERKLE_FLUSH_ERRORS_METRIC,
  MERKLE_INVOICES_ANCHORED_METRIC,
  MERKLE_PENDING_BATCHES_METRIC,
  MERKLE_SCHEDULERS_ARMED_METRIC,
} from "./merkle-anchor.metrics";
import {
  MERKLE_FLUSH_QUEUE,
  MERKLE_SEAL_QUEUE,
  MerkleAnchorFlushProcessor,
  MerkleAnchorSealProcessor,
} from "./merkle-anchor.processor";
import { MerkleAnchorSealService } from "./merkle-anchor-seal.service";

const SEAL_SCHEDULER_ID = "merkle-anchor-seal-hourly";
const FLUSH_SCHEDULER_ID = "merkle-anchor-flush-recurring";

// Lot E1 — registre Merkle + seam d'ancrage. Même pattern que RetentionModule
// (J3) : files BullMQ + jobs répétables armés dans onModuleInit, opt-in
// `MERKLE_ANCHOR_ENABLED`, jamais bloquant au démarrage.
@Module({
  imports: [
    BullModule.registerQueue({
      name: MERKLE_SEAL_QUEUE,
      defaultJobOptions: { removeOnComplete: 50, removeOnFail: 200 },
    }),
    BullModule.registerQueue({
      name: MERKLE_FLUSH_QUEUE,
      defaultJobOptions: { removeOnComplete: 50, removeOnFail: 200 },
    }),
  ],
  providers: [
    MerkleAnchorSealService,
    MerkleAnchorFlushService,
    MerkleAnchorSealProcessor,
    MerkleAnchorFlushProcessor,
    { provide: ANCHOR_SINK, useClass: NoopAnchorSink },
    makeCounterProvider({ name: MERKLE_BATCHES_SEALED_METRIC, help: "Tranches Merkle scellées" }),
    makeCounterProvider({ name: MERKLE_INVOICES_ANCHORED_METRIC, help: "Factures rattachées à une tranche" }),
    makeCounterProvider({
      name: MERKLE_FLUSH_ERRORS_METRIC,
      help: "Échecs d'appel au seam d'ancrage",
      labelNames: ["sink"],
    }),
    makeGaugeProvider({ name: MERKLE_PENDING_BATCHES_METRIC, help: "Tranches Merkle encore pending" }),
    makeGaugeProvider({ name: MERKLE_SCHEDULERS_ARMED_METRIC, help: "1 si les schedulers Merkle sont armés" }),
  ],
})
export class MerkleAnchorModule implements OnModuleInit {
  private readonly logger = new Logger(MerkleAnchorModule.name);

  constructor(
    @InjectQueue(MERKLE_SEAL_QUEUE) private readonly sealQueue: Queue,
    @InjectQueue(MERKLE_FLUSH_QUEUE) private readonly flushQueue: Queue,
    @InjectMetric(MERKLE_SCHEDULERS_ARMED_METRIC) private readonly armed: Gauge<string>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.armed.set(0);

    if (!merkleAnchorEnabled()) {
      this.logger.warn(
        'Registre Merkle désactivé (MERKLE_ANCHOR_ENABLED != "true"). Voir docs/runbooks/merkle-anchor.md.',
      );
      return;
    }
    try {
      await this.sealQueue.upsertJobScheduler(SEAL_SCHEDULER_ID, { every: SEAL_INTERVAL_MS }, { name: "run" });
      await this.flushQueue.upsertJobScheduler(FLUSH_SCHEDULER_ID, { every: FLUSH_INTERVAL_MS }, { name: "run" });
      this.armed.set(1);
      this.logger.log(
        `Registre Merkle actif (scellement /${SEAL_INTERVAL_MS / 3_600_000} h, flush /${FLUSH_INTERVAL_MS / 60_000} min)`,
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const code = (err as { code?: string }).code;
      this.logger.error(
        `Échec de l'armement des jobs Merkle${code ? ` [${code}]` : ""} — trust-api démarre quand même, les jobs ne tourneront pas`,
        err.stack ?? err.message,
      );
    }
  }
}
