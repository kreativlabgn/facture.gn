import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Counter } from "prom-client";

import type { PrismaClient } from "@facture-gn/db";

import { PRISMA_CLIENT } from "../common/prisma.module";
import {
  CLIENT_PORTAL_OTP_GRACE_MS,
  PENDING_MEMBER_INVITE_GRACE_MS,
  REVOKED_TOKEN_GRACE_MS,
  USSD_SESSION_GRACE_MS,
} from "./retention.constants";
import { RETENTION_DELETED_METRIC, RETENTION_ERRORS_METRIC } from "./retention.metrics";

export interface RetentionSummary {
  deletedByTable: Record<string, number>;
  errored: string[];
  /** Nombre total de règles évaluées — permet à l'appelant de distinguer
   *  « échec partiel » de « panne globale » (errored.length === ruleCount). */
  ruleCount: number;
}

interface PurgeRule {
  table: string;
  run: () => Promise<{ count: number }>;
}

// Lot J3 — purge périodique des tables opérationnelles éphémères. Logique PURE
// (Prisma mockable) : le processeur BullMQ n'est qu'un déclencheur.
// Chaque table est traitée dans un try/catch indépendant (pattern
// ReconciliationService, money-api) : une table en échec ne bloque jamais les
// autres, runOnce() ne rejette jamais. L'appelant (RetentionProcessor) décide
// quoi faire d'un `errored` non vide.
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @InjectMetric(RETENTION_DELETED_METRIC) private readonly deleted: Counter<string>,
    @InjectMetric(RETENTION_ERRORS_METRIC) private readonly errors: Counter<string>,
  ) {}

  async runOnce(now: Date = new Date()): Promise<RetentionSummary> {
    const rules = this.rules(now);
    const summary: RetentionSummary = { deletedByTable: {}, errored: [], ruleCount: rules.length };

    for (const rule of rules) {
      try {
        const { count } = await rule.run();
        summary.deletedByTable[rule.table] = count;
        // .inc(labels, count) crée la série même à count=0 → l'alerte « plateau
        // à 0 » du runbook devient branchable.
        this.deleted.inc({ table: rule.table }, count);
      } catch (error) {
        summary.errored.push(rule.table);
        this.errors.inc({ table: rule.table });
        const err = error instanceof Error ? error : new Error(String(error));
        const code = (err as { code?: string }).code;
        this.logger.error(
          `Purge ${rule.table} échouée${code ? ` [${code}]` : ""}`,
          err.stack ?? err.message,
        );
      }
    }

    return summary;
  }

  private rules(now: Date): PurgeRule[] {
    const olderThan = (graceMs: number) => ({ lt: new Date(now.getTime() - graceMs) });

    return [
      {
        table: "ussd_session",
        run: () =>
          this.prisma.ussdSession.deleteMany({
            where: { expiresAt: olderThan(USSD_SESSION_GRACE_MS) },
          }),
      },
      {
        table: "client_portal_otp",
        run: () =>
          this.prisma.clientPortalOtp.deleteMany({
            where: { expiresAt: olderThan(CLIENT_PORTAL_OTP_GRACE_MS) },
          }),
      },
      {
        table: "revoked_token",
        run: () =>
          this.prisma.revokedToken.deleteMany({
            where: { expiresAt: olderThan(REVOKED_TOKEN_GRACE_MS) },
          }),
      },
      {
        table: "pending_member_invite",
        run: () =>
          this.prisma.pendingMemberInvite.deleteMany({
            where: {
              acceptedAt: null,
              expiresAt: olderThan(PENDING_MEMBER_INVITE_GRACE_MS),
            },
          }),
      },
    ];
  }
}
