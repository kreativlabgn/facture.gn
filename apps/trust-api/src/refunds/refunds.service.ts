import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import type { CreateRefundDto } from "./dto/create-refund.dto";

@Injectable()
export class RefundsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // ADR-063, C13 — "credit_note = document comptable. refund = mouvement d'argent."
  // payment_link_payout (Djomy Payout) est créé "pending" : aucune intégration
  // Money Context payout n'existe dans ce repo (V2, ADR-089) — pas d'exécution ni
  // de confirmation automatique. cash/bank_transfer/credit_on_account sont des
  // attestations immédiates du staff (même principe que recordCashPayment()/
  // recordBankTransferPayment(), C1/C3) : "completed" dès la création.
  //
  // Security Audit 2026-08-23, finding #2 — même pattern d'idempotence que
  // PaymentsService (Payment.idempotencyKey) : sans lui, deux requêtes concurrentes
  // (double clic, retry réseau) passaient toutes deux la garde anti-sur-remboursement
  // ci-dessous avant qu'aucune n'ait committé, produisant un sur-remboursement réel.
  async create(creditNoteId: string, dto: CreateRefundDto, actorId: string, idempotencyKey: string) {
    const existing = await this.prisma.refund.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return existing;
    }

    const creditNote = await this.prisma.creditNote.findUniqueOrThrow({ where: { id: creditNoteId } });

    // Garde anti-sur-remboursement — même précédent que la garde anti-sur-crédit
    // de CreditNoteLine (C7), scopée ici à un seul avoir (pas de groupBy requis).
    // Un refund "failed" (tentative ratée, ex. provider indisponible) ne compte
    // jamais dans le solde déjà remboursé — il reste retentable. Reste une garde
    // best-effort hors transaction : la contrainte unique sur idempotencyKey
    // ci-dessus protège contre le rejeu de LA MÊME requête, pas contre deux
    // remboursements DISTINCTS (idempotencyKey différentes) soumis en vraie
    // concurrence — hors scope de ce correctif (même limite assumée par
    // CreditNoteLine/C7, jugée acceptable par 2 revues précédentes).
    const alreadyRefunded = await this.prisma.refund.aggregate({
      _sum: { amount: true },
      where: { creditNoteId, status: { not: "failed" } },
    });
    const remaining = creditNote.amount - (alreadyRefunded._sum.amount ?? 0n);
    if (dto.amount > remaining) {
      throw new ConflictException(
        `Montant à rembourser (${dto.amount}) supérieur au solde encore remboursable (${remaining}) de l'avoir ${creditNoteId}`,
      );
    }

    const isImmediatelyCompleted = dto.method !== "payment_link_payout";

    try {
      return await this.prisma.$transaction(async (tx) => {
        const refund = await tx.refund.create({
          data: {
            creditNoteId,
            invoiceId: creditNote.invoiceId,
            amount: dto.amount,
            method: dto.method,
            status: isImmediatelyCompleted ? "completed" : "pending",
            completedAt: isImmediatelyCompleted ? new Date() : null,
            idempotencyKey,
          },
        });

        await tx.invoiceEvent.create({
          data: {
            invoiceId: creditNote.invoiceId,
            type: "refund_issued",
            amount: dto.amount,
            actorId,
          },
        });

        return refund;
      });
    } catch (error) {
      // Course concurrente : deux requêtes avec la même Idempotency-Key arrivent en
      // parallèle, toutes deux passent le lookup initial avant que l'une des deux ne
      // committe — même pattern que PaymentsService.resolveIdempotencyRace().
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        const winner = await this.prisma.refund.findUnique({ where: { idempotencyKey } });
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }
}
