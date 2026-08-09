import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { detectCashAnomalyPatterns } from "./cash-anomaly-detection";
import type { CreatePaymentDto } from "./dto/create-payment.dto";
import type { ConfirmProviderPaymentDto } from "./dto/confirm-provider-payment.dto";
import type { RecordDepositDto } from "./dto/record-deposit.dto";

const PAYABLE_STATUSES = new Set(["issued", "partially_paid"]);

// Fenêtre glissante pour la détection de boucle client/montant (G1, ADR-032).
const STRUCTURING_LOOP_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async recordCashPayment(invoiceId: string, dto: CreatePaymentDto, idempotencyKey: string) {
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return existing;
    }

    // allowOverpayment: true — trop-perçu cash uniquement (C14, backlog explicite),
    // jamais pour recordProviderPayment() (lien généré pour un montant exact).
    const invoice = await this.getPayableInvoiceOrThrow(invoiceId, dto.amount, true);

    const payment = await this.createPaymentAndApply(invoiceId, idempotencyKey, dto.amount, {
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

    await this.detectAndRecordCashAnomaly(invoice, dto.amount);

    return payment;
  }

  // Appelé exclusivement par money-api après confirmation webhook (ADR-075) —
  // providerRef sert déjà de clé d'idempotence naturelle, pas de header client.
  // Aucune détection d'anomalie ici (G1, ADR-032) : les patterns actuels
  // (montant rond, boucle client) sont spécifiques au cash — le 3e pattern
  // d'ADR-032 ("écart MM vs facturé") couvrirait ce chemin mais est hors scope,
  // réservé à une extension future du même moteur (G3, ADR-091).
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

  // ADR-064 : un proforma n'accepte QUE des arrhes, jamais un paiement normal —
  // jamais appliqué à Invoice.amountPaid/amountDue (l'arrhes est un dépôt de
  // sécurité indépendant du solde de la facture, pas un règlement partiel).
  async recordDepositPayment(proformaId: string, dto: RecordDepositDto, idempotencyKey: string) {
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return existing;
    }

    const proforma = await this.prisma.invoice.findUnique({ where: { id: proformaId } });
    if (!proforma) {
      throw new NotFoundException(`Facture ${proformaId} introuvable`);
    }
    if (proforma.documentType !== "proforma") {
      throw new ConflictException(
        `Seul un proforma peut recevoir une arrhes (actuel : ${proforma.documentType})`,
      );
    }
    if (proforma.status !== "draft") {
      throw new ConflictException(
        `Proforma ${proformaId} ne peut recevoir d'arrhes depuis le statut ${proforma.status}`,
      );
    }

    const existingDeposit = await this.prisma.payment.findFirst({
      where: { invoiceId: proformaId, depositType: "arrhes" },
    });
    if (existingDeposit) {
      throw new ConflictException(`Proforma ${proformaId} a déjà une arrhes enregistrée`);
    }

    try {
      return await this.prisma.payment.create({
        data: {
          invoiceId: proformaId,
          status: "completed",
          idempotencyKey,
          amount: dto.amount,
          amountCollected: dto.amount,
          platformFeeAmount: 0n,
          gatewayFeeAmount: 0n,
          method: "cash",
          depositType: "arrhes",
          proofPhotoUrl: dto.proofPhotoUrl,
          proofGpsLat: dto.proofGpsLat,
          proofGpsLng: dto.proofGpsLng,
          proofSignature: dto.proofSignature,
        },
      });
    } catch (error) {
      // Course concurrente sur DEUX requêtes avec des Idempotency-Key différentes
      // (pas le cas déjà couvert par resolveIdempotencyRace, qui ne concerne qu'un
      // replay de la MÊME clé) : le garde applicatif findFirst ci-dessus laisse une
      // fenêtre de course, seul l'index unique partiel payment_one_arrhes_per_invoice
      // tranche côté DB — vérifié empiriquement, Prisma rapporte
      // meta.target=["invoice_id"], jamais "idempotency_key", donc jamais intercepté
      // par resolveIdempotencyRace seul.
      if (isUniqueConstraintViolation(error, "invoice_id")) {
        throw new ConflictException(`Proforma ${proformaId} a déjà une arrhes enregistrée`);
      }
      return this.resolveIdempotencyRace(error, idempotencyKey);
    }
  }

  private async getPayableInvoiceOrThrow(invoiceId: string, amount: bigint, allowOverpayment = false) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new NotFoundException(`Facture ${invoiceId} introuvable`);
    }
    if (!PAYABLE_STATUSES.has(invoice.status)) {
      throw new ConflictException(
        `Facture ${invoiceId} ne peut recevoir de paiement depuis le statut ${invoice.status}`,
      );
    }
    // C14 : le cash absorbe un trop-perçu (voir applyPaymentToInvoice()) plutôt que
    // de le rejeter — allowOverpayment contourne cette seule garde, jamais les
    // autres (statut, existence).
    if (!allowOverpayment && amount > invoice.amountDue) {
      throw new ConflictException(
        `Montant ${amount} supérieur au solde dû ${invoice.amountDue} — trop-perçu non géré pour ce mode de paiement`,
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
      return this.resolveIdempotencyRace(error, idempotencyKey);
    }
  }

  // G1, ADR-032 — "revue humaine systématique", jamais un rejet automatique.
  // Meilleur effort, HORS de la transaction de paiement (revue sécurité) : même
  // principe que PaymentLinkClient.tryGenerate() / le try/catch autour du lien de
  // paiement dans invoices.service.ts:issue() — un bug dans cette détection annexe
  // ne doit jamais faire échouer un encaissement cash déjà légitimement committé.
  // Écart MM vs facturé (3e pattern d'ADR-032) hors scope : nécessiterait une
  // corrélation Money Context, réservé à une extension future du même moteur (G3,
  // ADR-091).
  private async detectAndRecordCashAnomaly(
    invoice: { id: string; organizationId: string; customerId: string | null },
    amount: bigint,
  ) {
    try {
      let sameAmountRecentCount = 1; // ce paiement inclus

      // Sans customerId, aucune boucle attribuable à un client identifié —
      // limitation documentée (Invoice.customerId n'a pas de modèle Customer associé).
      if (invoice.customerId) {
        sameAmountRecentCount = await this.prisma.payment.count({
          where: {
            method: "cash",
            amount,
            collectedAt: { gte: new Date(Date.now() - STRUCTURING_LOOP_WINDOW_MS) },
            invoice: { organizationId: invoice.organizationId, customerId: invoice.customerId },
          },
        });
      }

      const patterns = detectCashAnomalyPatterns({ amount, sameAmountRecentCount });
      if (patterns.length === 0) {
        return;
      }

      await this.prisma.invoiceEvent.create({
        data: {
          invoiceId: invoice.id,
          type: "suspicious_cash_pattern_detected",
          actorId: null,
          amount,
          metadata: { patterns },
        },
      });
    } catch (error) {
      this.logger.warn(
        `Paiement cash sur la facture ${invoice.id} enregistré, mais la détection d'anomalie a échoué : ${(error as Error).message}`,
      );
    }
  }

  // Course concurrente : deux requêtes avec le même Idempotency-Key arrivent en
  // parallèle, toutes deux passent le lookup initial avant que l'une des deux ne
  // committe — la contrainte unique DB tranche, on renvoie le paiement gagnant
  // plutôt qu'un 500 brut sur la requête perdante. Partagé entre createPaymentAndApply()
  // et recordDepositPayment() — un seul endroit à maintenir pour ce comportement.
  private async resolveIdempotencyRace(error: unknown, idempotencyKey: string) {
    if (isUniqueConstraintViolation(error, "idempotency_key")) {
      const winner = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
      if (winner) {
        return winner;
      }
    }
    throw error;
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

    // C14 : amountDue ne peut devenir négatif qu'une seule fois — dès qu'il atteint
    // <=0 le statut passe à "paid", qui bloque tout nouveau paiement cash/provider
    // (PAYABLE_STATUSES). La valeur négative observée ici appartient donc forcément
    // à CE paiement, jamais à un autre en course — correction sûre dans la même
    // transaction (verrou de ligne tenu depuis l'update ci-dessus), sans recalcul
    // depuis une lecture faite hors transaction (même principe race-free que
    // l'incrément relatif ci-dessus, C1).
    if (updatedInvoice.amountDue < 0n) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          amountDue: 0n,
          overpaymentAmount: { increment: -updatedInvoice.amountDue },
          status: "paid",
        },
      });
      return;
    }

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: updatedInvoice.amountDue <= 0n ? "paid" : "partially_paid" },
    });
  }
}
