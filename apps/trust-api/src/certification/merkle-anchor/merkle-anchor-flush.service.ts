import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Counter } from "prom-client";

import type { PrismaClient } from "@facture-gn/db";

import { PRISMA_CLIENT } from "../../common/prisma.module";
import { ANCHOR_SINK, type AnchorSink } from "./anchor-sink";
import { FLUSH_BATCH_LIMIT } from "./merkle-anchor.constants";
import { MERKLE_FLUSH_ERRORS_METRIC } from "./merkle-anchor.metrics";

export interface FlushSummary {
  checked: number;
  anchored: number;
  stillPending: number;
  /** ids des tranches dont l'appel au sink a levé (transitoire — reste pending). */
  errored: string[];
}

// Lot E1 — pousse les tranches `pending` vers le seam d'ancrage externe.
// try/catch PAR tranche : un sink transitoirement KO ne bloque pas les autres,
// ne rejette jamais. `failed` n'est JAMAIS posé automatiquement (décision
// manuelle/runbook) — une tranche non ancrée reste `pending` et sera réessayée.
@Injectable()
export class MerkleAnchorFlushService {
  private readonly logger = new Logger(MerkleAnchorFlushService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(ANCHOR_SINK) private readonly sink: AnchorSink,
    @InjectMetric(MERKLE_FLUSH_ERRORS_METRIC) private readonly errors: Counter<string>,
  ) {}

  async flushPending(limit: number = FLUSH_BATCH_LIMIT): Promise<FlushSummary> {
    const pending = await this.prisma.merkleAnchorBatch.findMany({
      where: { anchorStatus: "pending" },
      orderBy: { hourStart: "asc" },
      take: limit,
    });

    const summary: FlushSummary = { checked: pending.length, anchored: 0, stillPending: 0, errored: [] };

    for (const batch of pending) {
      try {
        const receipt = await this.sink.anchor(batch.merkleRoot, batch.id);
        if (!receipt) {
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

    return summary;
  }
}
