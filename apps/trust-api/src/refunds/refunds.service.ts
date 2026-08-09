import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
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
  async create(creditNoteId: string, dto: CreateRefundDto, actorId: string) {
    const creditNote = await this.prisma.creditNote.findUniqueOrThrow({ where: { id: creditNoteId } });

    // Garde anti-sur-remboursement — même précédent que la garde anti-sur-crédit
    // de CreditNoteLine (C7), scopée ici à un seul avoir (pas de groupBy requis).
    // Un refund "failed" (tentative ratée, ex. provider indisponible) ne compte
    // jamais dans le solde déjà remboursé — il reste retentable.
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

    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          creditNoteId,
          invoiceId: creditNote.invoiceId,
          amount: dto.amount,
          method: dto.method,
          status: isImmediatelyCompleted ? "completed" : "pending",
          completedAt: isImmediatelyCompleted ? new Date() : null,
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
  }
}
