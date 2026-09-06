import { randomUUID } from "node:crypto";

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { BankTransaction, Payment, Prisma, PrismaClient } from "@facture-gn/db";

import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { PaymentsService } from "../payments/payments.service";
import { fingerprint, suggestMatches, type MatchSuggestion } from "./bank-matching";
import { MAX_SUGGESTIONS_PER_TX } from "./bank-reconciliation.constants";
import type { ImportBankTransactionsDto } from "./dto/import-bank-transactions.dto";
import type { ListBankTransactionsQueryDto } from "./dto/list-bank-transactions-query.dto";

// Lot rapprochement bancaire (ADR-052, ADR-117 provisoire).
//
// - import      : dédoublonne par empreinte (@unique), persiste les virements
//                 entrants. Aucune suggestion calculée ici.
// - list        : lecture ; pour les transactions unmatched, calcule les
//                 suggestions via UN SEUL invoice.findMany (jamais un N+1).
// - confirm     : "revendication d'abord" (updateMany where state=unmatched) —
//                 ferme la course de deux confirm concurrents — puis délègue à
//                 PaymentsService.recordBankTransferPayment (idempotence,
//                 paiement partiel, transitions de statut — chemin C3 inchangé).
// - ignore      : le staff écarte une transaction (pas un virement client).
//
// Jamais d'auto-application : le staff valide chaque couple (transaction, facture)
// avant qu'un Payment soit créé. Une erreur se corrige par avoir + remboursement
// (flux C13/ADR-063), jamais par "dé-confirmation" dans ce lot.

type ImportRowResult = {
  index: number;
  status: "imported" | "duplicate";
  transactionId: string;
};

export interface ImportResult {
  importBatchId: string;
  imported: number;
  duplicate: number;
  results: ImportRowResult[];
}

const PAYABLE_INVOICE_STATUSES = ["issued", "partially_paid"] as const;

export interface TransactionWithSuggestions extends BankTransaction {
  suggestions: MatchSuggestion[];
}

@Injectable()
export class BankReconciliationService {
  private readonly logger = new Logger(BankReconciliationService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly paymentsService: PaymentsService,
  ) {}

  async importTransactions(
    organizationId: string,
    dto: ImportBankTransactionsDto,
    userId: string,
  ): Promise<ImportResult> {
    const importBatchId = randomUUID();
    const results: ImportRowResult[] = [];
    let imported = 0;
    let duplicate = 0;

    for (const [index, row] of dto.transactions.entries()) {
      const fp = fingerprint({
        organizationId,
        valueDate: row.valueDate,
        amountCentimes: row.amountCentimes,
        rawLabel: row.rawLabel,
      });

      try {
        const created = await this.prisma.bankTransaction.create({
          data: {
            organizationId,
            importBatchId,
            valueDate: row.valueDate,
            amountCentimes: row.amountCentimes,
            rawLabel: row.rawLabel,
            counterpartyLabel: row.counterpartyLabel ?? null,
            bankRef: row.bankRef ?? null,
            fingerprint: fp,
            importedByUserId: userId,
          },
        });
        imported += 1;
        results.push({ index, status: "imported", transactionId: created.id });
      } catch (error) {
        if (!isUniqueConstraintViolation(error, "fingerprint")) {
          throw error;
        }
        const existing = await this.prisma.bankTransaction.findUnique({
          where: { fingerprint: fp },
          select: { id: true },
        });
        if (!existing) {
          // P2002 sur `fingerprint` garantit que la ligne existe (DELETE est
          // interdit par trigger) — une absence ici est une incohérence à
          // remonter, jamais un id vide silencieux dans le rapport.
          throw new Error(
            `Incohérence import rapprochement bancaire : ligne ${index} en doublon (P2002) mais introuvable par empreinte`,
          );
        }
        duplicate += 1;
        results.push({ index, status: "duplicate", transactionId: existing.id });
      }
    }

    return { importBatchId, imported, duplicate, results };
  }

  async listTransactions(
    organizationId: string,
    query: ListBankTransactionsQueryDto,
  ): Promise<TransactionWithSuggestions[]> {
    const where: Prisma.BankTransactionWhereInput = { organizationId };
    if (query.state) where.state = query.state;
    if (query.importBatchId) where.importBatchId = query.importBatchId;

    const transactions = await this.prisma.bankTransaction.findMany({
      where,
      orderBy: { valueDate: "desc" },
      take: query.take,
      skip: query.skip,
    });

    const hasUnmatched = transactions.some((tx) => tx.state === "unmatched");
    // UN SEUL findMany des factures payables, quel que soit le nombre de
    // transactions — jamais un N+1. Non exécuté si rien à suggérer.
    const payableInvoices = hasUnmatched
      ? await this.prisma.invoice.findMany({
          where: { organizationId, status: { in: [...PAYABLE_INVOICE_STATUSES] } },
          select: { id: true, number: true, certificationId: true, amountDue: true, issuedAt: true },
        })
      : [];

    return transactions.map((tx) => ({
      ...tx,
      suggestions:
        tx.state === "unmatched"
          ? suggestMatches(
              { valueDate: tx.valueDate, amountCentimes: tx.amountCentimes, rawLabel: tx.rawLabel },
              payableInvoices,
            ).slice(0, MAX_SUGGESTIONS_PER_TX)
          : [],
    }));
  }

  async confirmMatch(
    organizationId: string,
    transactionId: string,
    invoiceId: string,
    userId: string,
  ): Promise<{ transaction: BankTransaction; payment: Payment }> {
    const transaction = await this.prisma.bankTransaction.findFirst({
      where: { id: transactionId, organizationId },
    });
    if (!transaction) {
      throw new NotFoundException(`Transaction bancaire ${transactionId} introuvable`);
    }

    // La facture DOIT appartenir à la même organisation — recordBankTransferPayment
    // ne vérifie pas l'organisation, ne jamais le lui déléguer (fuite inter-tenant).
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { organizationId: true },
    });
    if (!invoice || invoice.organizationId !== organizationId) {
      throw new NotFoundException(`Facture ${invoiceId} introuvable pour cette organisation`);
    }

    const now = new Date();
    // Revendication d'abord : ferme la course "deux confirm concurrents sur la
    // même transaction vers des factures différentes" (sinon la clé d'idempotence
    // dérivée renverrait le mauvais Payment à la 2ᵉ confirmation).
    const claim = await this.prisma.bankTransaction.updateMany({
      where: { id: transactionId, organizationId, state: "unmatched" },
      data: {
        state: "matched",
        matchedInvoiceId: invoiceId,
        resolvedByUserId: userId,
        resolvedAt: now,
      },
    });
    if (claim.count === 0) {
      // Reprise d'un confirm interrompu entre la création du paiement (étape
      // suivante) et la pose de matchedPaymentId : la transaction est déjà
      // `matched` vers CETTE facture mais sans paiement lié.
      // recordBankTransferPayment est idempotent sur la clé dérivée → on
      // récupère le paiement existant et on referme, plutôt que de laisser la
      // transaction bloquée. Tout autre cas (déjà rapprochée ailleurs, ignorée,
      // introuvable) → 409.
      if (
        transaction.state === "matched" &&
        transaction.matchedInvoiceId === invoiceId &&
        transaction.matchedPaymentId === null
      ) {
        this.logger.warn(
          `Reprise d'un rapprochement bancaire interrompu — transaction ${transactionId}, facture ${invoiceId}`,
        );
        const recovered = await this.paymentsService.recordBankTransferPayment(
          invoiceId,
          organizationId,
          { amount: transaction.amountCentimes },
          `bank-reconciliation:${transactionId}`,
        );
        const repaired = await this.prisma.bankTransaction.update({
          where: { id: transactionId },
          data: { matchedPaymentId: recovered.id },
        });
        return { transaction: repaired, payment: recovered };
      }
      throw new ConflictException(
        `Transaction bancaire ${transactionId} déjà rapprochée ou ignorée`,
      );
    }

    let payment: Payment;
    try {
      payment = await this.paymentsService.recordBankTransferPayment(
        invoiceId,
        organizationId,
        { amount: transaction.amountCentimes },
        `bank-reconciliation:${transactionId}`,
      );
    } catch (error) {
      // Annule la revendication : la transaction redevient rapprochable. Cette
      // compensation ne doit JAMAIS masquer l'erreur métier d'origine (souvent
      // actionnable : « facture non payable », « montant > solde dû ») — si elle
      // échoue elle-même, on la logue avec le contexte et on relève quand même
      // l'erreur d'origine. La transaction reste alors `matched` sans paiement :
      // un `confirm` ultérieur la reprend via la branche de reprise ci-dessus.
      try {
        await this.prisma.bankTransaction.updateMany({
          where: { id: transactionId, state: "matched" },
          data: {
            state: "unmatched",
            matchedInvoiceId: null,
            matchedPaymentId: null,
            resolvedByUserId: null,
            resolvedAt: null,
          },
        });
      } catch (revertError) {
        this.logger.error(
          `Échec de l'annulation de la revendication du rapprochement — transaction ${transactionId} laissée en état 'matched' sans paiement, à reprendre`,
          revertError instanceof Error ? revertError.stack : String(revertError),
        );
      }
      throw error;
    }

    const updated = await this.prisma.bankTransaction.update({
      where: { id: transactionId },
      data: { matchedPaymentId: payment.id },
    });

    return { transaction: updated, payment };
  }

  async ignoreTransaction(
    organizationId: string,
    transactionId: string,
    userId: string,
  ): Promise<BankTransaction> {
    const claim = await this.prisma.bankTransaction.updateMany({
      where: { id: transactionId, organizationId, state: "unmatched" },
      data: { state: "ignored", resolvedByUserId: userId, resolvedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new ConflictException(
        `Transaction bancaire ${transactionId} introuvable ou déjà résolue`,
      );
    }
    return this.prisma.bankTransaction.findUniqueOrThrow({ where: { id: transactionId } });
  }
}
