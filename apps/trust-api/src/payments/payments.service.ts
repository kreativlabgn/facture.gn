import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import type { CreatePaymentDto } from "./dto/create-payment.dto";
import type { ConfirmProviderPaymentDto } from "./dto/confirm-provider-payment.dto";

const PAYABLE_STATUSES = new Set(["issued", "partially_paid"]);

@Injectable()
export class PaymentsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async recordCashPayment(invoiceId: string, dto: CreatePaymentDto, idempotencyKey: string) {
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return existing;
    }

    await this.getPayableInvoiceOrThrow(invoiceId, dto.amount);

    return this.createPaymentAndApply(invoiceId, idempotencyKey, dto.amount, {
      amount: dto.amount,
      amountCollected: dto.amount,
      platformFeeAmount: 0n,
      gatewayFeeAmount: 0n,
      method: "cash",
      proofPhotoUrl: dto.proofPhotoUrl,
      proofGpsLat: dto.proofGpsLat,
      proofGpsLng: dto.proofGpsLng,
      proofSignature: dto.proofSignature,
    });
  }

  // Appelé exclusivement par money-api après confirmation webhook (ADR-075) —
  // providerRef sert déjà de clé d'idempotence naturelle, pas de header client.
  async recordProviderPayment(invoiceId: string, dto: ConfirmProviderPaymentDto) {
    const idempotencyKey = dto.providerRef;
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return existing;
    }

    await this.getPayableInvoiceOrThrow(invoiceId, dto.amountGnf);

    return this.createPaymentAndApply(invoiceId, idempotencyKey, dto.amountGnf, {
      amount: dto.amountGnf,
      amountCollected: dto.amountGnf,
      platformFeeAmount: 0n, // grille 5 paliers ADR-074 simplifiée à ce stade, cf. Phase 1
      gatewayFeeAmount: dto.feeGatewayGnf,
      method: "payment_link",
      providerRef: dto.providerRef,
    });
  }

  private async getPayableInvoiceOrThrow(invoiceId: string, amount: bigint) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new NotFoundException(`Facture ${invoiceId} introuvable`);
    }
    if (!PAYABLE_STATUSES.has(invoice.status)) {
      throw new ConflictException(
        `Facture ${invoiceId} ne peut recevoir de paiement depuis le statut ${invoice.status}`,
      );
    }
    if (amount > invoice.amountDue) {
      throw new ConflictException(
        `Montant ${amount} supérieur au solde dû ${invoice.amountDue} — trop-perçu non géré ici`,
      );
    }
    return invoice;
  }

  private async createPaymentAndApply(
    invoiceId: string,
    idempotencyKey: string,
    amount: bigint,
    paymentData: Omit<Prisma.PaymentUncheckedCreateInput, "invoiceId" | "status" | "idempotencyKey">,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            invoiceId,
            status: "completed",
            idempotencyKey,
            ...paymentData,
          },
        });

        await this.applyPaymentToInvoice(tx, invoiceId, amount);

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

  // Incréments atomiques, jamais une valeur absolue recalculée depuis une lecture
  // faite hors transaction : sous deux paiements concurrents sur la même facture
  // (idempotency_key différentes, cash et/ou payment_link mixés — ADR-062), Postgres
  // sérialise les deux écritures au niveau ligne — aucun des deux ne peut
  // silencieusement écraser l'effet de l'autre sur amountPaid/amountDue. Partagée
  // entre recordCashPayment() et recordProviderPayment() — un seul endroit à
  // maintenir pour ce comportement (bug corrigé une fois, C1).
  private async applyPaymentToInvoice(tx: Prisma.TransactionClient, invoiceId: string, amount: bigint) {
    const updatedInvoice = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: { increment: amount },
        amountDue: { decrement: amount },
      },
    });

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: updatedInvoice.amountDue <= 0n ? "paid" : "partially_paid" },
    });
  }
}
