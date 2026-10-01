import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";

const QUEUE_THRESHOLDS = {
  warningWaiting: 50,
  criticalWaiting: 200,
  warningFailed: 5,
  criticalFailed: 25,
} as const;

type QueueStatus = "healthy" | "warning" | "critical" | "unknown";

export interface InfrastructureQueueSnapshot {
  service: "trust-api";
  name: string;
  status: QueueStatus;
  counts: {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
  };
  thresholds: typeof QUEUE_THRESHOLDS;
  checkedAt: string;
}

export interface InfrastructureSnapshot {
  generatedAt: string;
  overall: "healthy" | "degraded" | "unavailable";
  services: {
    trustApi: { status: "up"; live: true; ready: "unknown"; httpP95Ms: null };
    moneyApi: { status: "unknown"; live: null; ready: null; httpP95Ms: null };
  };
  queues: InfrastructureQueueSnapshot[];
  partialFailures: Array<{ source: "money-api"; code: "UNAVAILABLE"; message: string }>;
}

@Injectable()
export class InfrastructureService {
  constructor(
    @InjectQueue("ocr-pipeline") private readonly ocr: Queue,
    @InjectQueue("etax-synchronization") private readonly etax: Queue,
    @InjectQueue("pdp-ingestion") private readonly pdp: Queue,
    @InjectQueue("retention") private readonly retention: Queue,
    @InjectQueue("merkle-anchor-seal") private readonly merkleSeal: Queue,
    @InjectQueue("merkle-anchor-flush") private readonly merkleFlush: Queue,
  ) {}

  async snapshot(): Promise<InfrastructureSnapshot> {
    const generatedAt = new Date().toISOString();
    const queues = await Promise.all([
      this.readQueue("ocr-pipeline", this.ocr),
      this.readQueue("etax-synchronization", this.etax),
      this.readQueue("pdp-ingestion", this.pdp),
      this.readQueue("retention", this.retention),
      this.readQueue("merkle-anchor-seal", this.merkleSeal),
      this.readQueue("merkle-anchor-flush", this.merkleFlush),
    ]);
    const hasCriticalQueue = queues.some((queue) => queue.status === "critical");
    const hasWarningQueue = queues.some((queue) => queue.status === "warning" || queue.status === "unknown");

    return {
      generatedAt,
      overall: hasCriticalQueue ? "degraded" : hasWarningQueue ? "degraded" : "healthy",
      services: {
        trustApi: { status: "up", live: true, ready: "unknown", httpP95Ms: null },
        moneyApi: { status: "unknown", live: null, ready: null, httpP95Ms: null },
      },
      queues,
      partialFailures: [
        { source: "money-api", code: "UNAVAILABLE", message: "État Money indisponible" },
      ],
    };
  }

  private async readQueue(name: string, queue: Queue): Promise<InfrastructureQueueSnapshot> {
    const checkedAt = new Date().toISOString();
    try {
      // getJobCounts() rend { [index: string]: number } quels que soient les
      // types demandés (signature BullMQ v6, pas de tuple corrélé aux
      // arguments) — impossible à assigner structurellement à la forme exacte
      // ci-dessus sans la reconstruire clé par clé, avec un repli à 0 si une
      // clé manquait jamais de la réponse Redis.
      const raw = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
      const counts = {
        waiting: raw.waiting ?? 0,
        active: raw.active ?? 0,
        delayed: raw.delayed ?? 0,
        failed: raw.failed ?? 0,
        completed: raw.completed ?? 0,
      };
      const status =
        counts.failed >= QUEUE_THRESHOLDS.criticalFailed || counts.waiting >= QUEUE_THRESHOLDS.criticalWaiting
          ? "critical"
          : counts.failed >= QUEUE_THRESHOLDS.warningFailed || counts.waiting >= QUEUE_THRESHOLDS.warningWaiting
            ? "warning"
            : "healthy";
      return { service: "trust-api", name, status, counts, thresholds: QUEUE_THRESHOLDS, checkedAt };
    } catch {
      return {
        service: "trust-api",
        name,
        status: "unknown",
        counts: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 },
        thresholds: QUEUE_THRESHOLDS,
        checkedAt,
      };
    }
  }
}
