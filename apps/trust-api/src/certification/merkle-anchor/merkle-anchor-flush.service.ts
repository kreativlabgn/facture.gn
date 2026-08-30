import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Counter, Gauge } from "prom-client";

import type { PrismaClient } from "@facture-gn/db";

import { PRISMA_CLIENT } from "../../common/prisma.module";
import { ANCHOR_SINK, type AnchorSink } from "./anchor-sink";
import { FLUSH_BATCH_LIMIT } from "./merkle-anchor.constants";
import { MERKLE_FLUSH_ERRORS_METRIC, MERKLE_PENDING_BATCHES_METRIC } from "./merkle-anchor.metrics";

export interface FlushSummary {
  checked: number;
  anchored: number;
  stillPending: number;
  /** ids des tranches dont l'appel au sink a levé (transitoire — reste pending). */
  errored: string[];
  /** total de tranches encore `pending` en base après ce passage. */
  pendingTotal: number;
}

// Lot E1 — pousse les tranches `pending` vers le seam d'ancrage externe.
// try/catch PAR tranche : un sink transitoirement KO ne bloque pas les autres,
// ne rejette jamais. `failed` n'est JAMAIS posé automatiquement (décision
// manuelle/runbook) — une tranche non ancrée reste `pending`, `anchor_attempts`
// s'incrémente, et l'alerte se pilote sur « pending + attempts élevé ».
@Injectable()
export class MerkleAnchorFlushService {
  private readonly logger = new Logger(MerkleAnchorFlushService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(ANCHOR_SINK) private readonly sink: AnchorSink,
    @InjectMetric(MERKLE_FLUSH_ERRORS_METRIC) private readonly errors: Counter<string>,
    @InjectMetric(MERKLE_PENDING_BATCHES_METRIC) private readonly pending: Gauge<string>,
  ) {}

  async flushPending(limit: number = FLUSH_BATCH_LIMIT): Promise<FlushSummary> {
    const batches = await this.prisma.merkleAnchorBatch.findMany({
      where: { anchorStatus: "pending" },
      orderBy: { asOf: "asc" },
      take: limit,
    });

    const summary: FlushSummary = {
      checked: batches.length,
      anchored: 0,
      stillPending: 0,
      errored: [],
      pendingTotal: 0,
    };

    for (const batch of batches) {
      try {
        const receipt = await this.sink.anchor(batch.merkleRoot, batch.id);
        if (!receipt) {
          await this.prisma.merkleAnchorBatch.update({
            where: { id: batch.id },
            data: { anchorAttempts: { increment: 1 } },
          });
          summary.stillPending++;
          continue;
        }
        await this.prisma.merkleAnchorBatch.update({
          where: { id: batch.id },
          data: {
            anchorStatus: "anchored",
            anchorProof: receipt.proof,
            anchorRef: receipt.ref,
            anchoredAt: receipt.anchoredAt,
            anchorAttempts: { increment: 1 },
          },
        });
        summary.anchored++;
      } catch (error) {
        summary.errored.push(batch.id);
        this.errors.inc({ sink: this.sink.name });
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(
          `Ancrage de la tranche ${batch.id} échoué [sink ${this.sink.name}] — reste pending`,
          err.stack ?? err.message,
        );
      }
    }

    summary.pendingTotal = await this.prisma.merkleAnchorBatch.count({ where: { anchorStatus: "pending" } });
    this.pending.set(summary.pendingTotal);

    return summary;
  }
}
