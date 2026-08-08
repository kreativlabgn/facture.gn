import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import type { CreatePaymentDto } from "./dto/create-payment.dto";

const PAYABLE_STATUSES = new Set(["issued", "partially_paid"]);

@Injectable()
export class PaymentsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async recordCashPayment(invoiceId: string, dto: CreatePaymentDto, idempotencyKey: string) {
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return existing;
    }

    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new NotFoundException(`Facture ${invoiceId} introuvable`);
    }
    if (!PAYABLE_STATUSES.has(invoice.status)) {
      throw new ConflictException(
        `Facture ${invoiceId} ne peut recevoir de paiement depuis le statut ${invoice.status}`,
      );
    }
    if (dto.amount > invoice.amountDue) {
      throw new ConflictException(
        `Montant ${dto.amount} supérieur au solde dû ${invoice.amountDue} — trop-perçu non géré ici`,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            invoiceId,
            amount: dto.amount,
            amountCollected: dto.amount,
            platformFeeAmount: 0n,
            gatewayFeeAmount: 0n,
            method: "cash",
            status: "completed",
            idempotencyKey,
            proofPhotoUrl: dto.proofPhotoUrl,
            proofGpsLat: dto.proofGpsLat,
            proofGpsLng: dto.proofGpsLng,
            proofSignature: dto.proofSignature,
          },
        });

        // Incréments atomiques, jamais une valeur absolue recalculée depuis une
        // lecture faite hors transaction : sous deux paiements concurrents sur la
        // même facture avec des idempotency_key différentes, Postgres sérialise les
        // deux écritures au niveau ligne — aucun des deux ne peut silencieusement
        // écraser l'effet de l'autre sur amountPaid/amountDue.
        const updatedInvoice = await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            amountPaid: { increment: dto.amount },
            amountDue: { decrement: dto.amount },
          },
        });

        await tx.invoice.update({
          where: { id: invoiceId },
          data: { status: updatedInvoice.amountDue <= 0n ? "paid" : "partially_paid" },
        });

        return payment;
      });
    } catch (error) {
      // Course concurrente : deux requêtes avec le même Idempotency-Key arrivent en
      // parallèle, toutes deux passent le lookup initial avant que l'une des deux ne
      // committe — la contrainte unique DB tranche, on renvoie le paiement gagnant
      // plutôt qu'un 500 brut sur la requête perdante.
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        const winner = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }
}
