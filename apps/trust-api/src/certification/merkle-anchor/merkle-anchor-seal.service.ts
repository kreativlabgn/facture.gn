import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Counter } from "prom-client";

import type { PrismaClient } from "@facture-gn/db";

import { PRISMA_CLIENT } from "../../common/prisma.module";
import { buildMerkleRoot } from "./merkle";
import { GENESIS_ROOT, SEAL_INTERVAL_MS } from "./merkle-anchor.constants";
import {
  MERKLE_BATCHES_SEALED_METRIC,
  MERKLE_INVOICES_ANCHORED_METRIC,
} from "./merkle-anchor.metrics";

export interface SealSummary {
  batchCreated: boolean;
  hourStart: string | null;
  leafCount: number;
  skipped: "empty" | "already-sealed" | null;
}

/** Début de l'heure UTC contenant `d` (jamais l'heure locale — serveurs UTC). */
function truncateToHourUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
}

// Lot E1 — scellement du registre Merkle. Un run = AU PLUS UNE tranche,
// couvrant toutes les factures certifiées non encore rattachées dont `issuedAt`
// précède l'heure courante (les retardataires d'heures antérieures sont inclus
// naturellement). Logique pure (Prisma injecté) : le processeur BullMQ n'est
// qu'un déclencheur.
@Injectable()
export class MerkleAnchorSealService {
  private readonly logger = new Logger(MerkleAnchorSealService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @InjectMetric(MERKLE_BATCHES_SEALED_METRIC) private readonly sealed: Counter<string>,
    @InjectMetric(MERKLE_INVOICES_ANCHORED_METRIC) private readonly anchored: Counter<string>,
  ) {}

  async sealDue(now: Date = new Date()): Promise<SealSummary> {
    const boundary = truncateToHourUtc(now);
    const hourStart = new Date(boundary.getTime() - SEAL_INTERVAL_MS);

    const invoices = await this.prisma.invoice.findMany({
      where: { hash: { not: null }, anchorBatchId: null, issuedAt: { lt: boundary } },
      select: { id: true, hash: true },
      orderBy: { hash: "asc" },
    });
    if (invoices.length === 0) {
      return { batchCreated: false, hourStart: null, leafCount: 0, skipped: "empty" };
    }

    const leafHashes = invoices.map((i) => i.hash as string);
    const merkleRoot = buildMerkleRoot(leafHashes);
    const last = await this.prisma.merkleAnchorBatch.findFirst({
      orderBy: { hourStart: "desc" },
      select: { merkleRoot: true },
    });
    const previousRoot = last?.merkleRoot ?? GENESIS_ROOT;

    try {
      const batch = await this.prisma.$transaction(async (tx) => {
        const created = await tx.merkleAnchorBatch.create({
          data: { hourStart, merkleRoot, previousRoot, leafCount: invoices.length },
        });
        await tx.invoice.updateMany({
          where: { id: { in: invoices.map((i) => i.id) }, anchorBatchId: null },
          data: { anchorBatchId: created.id },
        });
        return created;
      });
      this.sealed.inc();
      this.anchored.inc(invoices.length);
      this.logger.log(
        `Tranche Merkle scellée : ${batch.id} (${invoices.length} factures, root ${merkleRoot.slice(0, 12)}…)`,
      );
      return {
        batchCreated: true,
        hourStart: batch.hourStart.toISOString(),
        leafCount: invoices.length,
        skipped: null,
      };
    } catch (error) {
      // Seul hour_start @unique est faillible ici (course entre deux runs).
      if ((error as { code?: string }).code === "P2002") {
        return { batchCreated: false, hourStart: hourStart.toISOString(), leafCount: 0, skipped: "already-sealed" };
      }
      throw error;
    }
  }
}
