import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Counter } from "prom-client";

import type { PrismaClient } from "@facture-gn/db";

import { PRISMA_CLIENT } from "../../common/prisma.module";
import { buildMerkleRoot } from "./merkle";
import { GENESIS_ROOT, MAX_LEAVES_PER_BATCH } from "./merkle-anchor.constants";
import {
  MERKLE_BATCHES_SEALED_METRIC,
  MERKLE_INVOICES_ANCHORED_METRIC,
} from "./merkle-anchor.metrics";

export interface SealSummary {
  batchCreated: boolean;
  asOf: string | null;
  leafCount: number;
  /** true si la tranche a été plafonnée à MAX_LEAVES_PER_BATCH (backlog). */
  capped: boolean;
  skipped: "empty" | "already-sealed" | null;
}

/** Début de l'heure UTC contenant `d` (jamais l'heure locale — serveurs UTC). */
function truncateToHourUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
}

// Lot E1 — scellement du registre Merkle. Un run = AU PLUS UNE tranche,
// couvrant les factures certifiées non encore rattachées dont `issuedAt`
// précède l'heure courante (`asOf` = borne haute exclusive réelle ; les
// retardataires d'heures antérieures sont inclus naturellement, `coverageFrom`
// reflète la période réellement engagée). Plafonné à MAX_LEAVES_PER_BATCH — un
// backlog après long downtime se résorbe sur plusieurs runs. Logique pure
// (Prisma injecté) : le processeur BullMQ n'est qu'un déclencheur.
@Injectable()
export class MerkleAnchorSealService {
  private readonly logger = new Logger(MerkleAnchorSealService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @InjectMetric(MERKLE_BATCHES_SEALED_METRIC) private readonly sealed: Counter<string>,
    @InjectMetric(MERKLE_INVOICES_ANCHORED_METRIC) private readonly anchored: Counter<string>,
  ) {}

  async sealDue(now: Date = new Date()): Promise<SealSummary> {
    const asOf = truncateToHourUtc(now);

    const invoices = await this.prisma.invoice.findMany({
      where: { hash: { not: null }, anchorBatchId: null, issuedAt: { lt: asOf } },
      select: { id: true, hash: true, issuedAt: true },
      // Ordre TOTAL déterministe (hash seul n'est pas total en cas d'égalité) —
      // le même que la reconstruction de preuve dans verification.service.
      orderBy: [{ hash: "asc" }, { id: "asc" }],
      take: MAX_LEAVES_PER_BATCH,
    });
    if (invoices.length === 0) {
      return { batchCreated: false, asOf: null, leafCount: 0, capped: false, skipped: "empty" };
    }

    const leafHashes = invoices.map((i) => i.hash as string);
    const merkleRoot = buildMerkleRoot(leafHashes);
    const coverageFrom = invoices.reduce(
      (min, i) => (i.issuedAt && i.issuedAt < min ? i.issuedAt : min),
      invoices[0].issuedAt as Date,
    );
    const capped = invoices.length === MAX_LEAVES_PER_BATCH;

    try {
      const batch = await this.prisma.$transaction(async (tx) => {
        // previousRoot lu DANS la transaction : ferme la fenêtre où deux runs
        // concurrents d'`asOf` différents liraient le même prédécesseur.
        const last = await tx.merkleAnchorBatch.findFirst({
          orderBy: { asOf: "desc" },
          select: { merkleRoot: true },
        });
        const created = await tx.merkleAnchorBatch.create({
          data: {
            asOf,
            coverageFrom,
            merkleRoot,
            previousRoot: last?.merkleRoot ?? GENESIS_ROOT,
            leafCount: invoices.length,
          },
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
        `Tranche Merkle scellée : ${batch.id} (${invoices.length} factures${capped ? ", PLAFONNÉE" : ""}, root ${merkleRoot.slice(0, 12)}…)`,
      );
      return {
        batchCreated: true,
        asOf: batch.asOf.toISOString(),
        leafCount: invoices.length,
        capped,
        skipped: null,
      };
    } catch (error) {
      // Seul as_of @unique est faillible ici (course entre deux runs).
      if ((error as { code?: string }).code === "P2002") {
        return { batchCreated: false, asOf: asOf.toISOString(), leafCount: 0, capped: false, skipped: "already-sealed" };
      }
      throw error;
    }
  }
}
