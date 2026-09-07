import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { InvoiceStatus, Prisma, PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { PaymentLinkClient } from "../money-client/payment-link-client";
import { computePlatformFee } from "../common/commission-grid";
import { detectCashAnomalyPatterns, type CashAnomalyPattern } from "./cash-anomaly-detection";
import { isCashProofRequirementMet } from "./cash-proof-requirement";
import { detectNonCashRatioDrop, RATIO_WINDOW_DAYS } from "./non-cash-ratio-drop";
import { CASH_PROOF_THRESHOLD_GNF_CENTIMES, type CreatePaymentDto } from "./dto/create-payment.dto";
import type { ConfirmProviderPaymentDto } from "./dto/confirm-provider-payment.dto";
import type { RecordDepositDto } from "./dto/record-deposit.dto";
import type { CreateBankTransferPaymentDto } from "./dto/create-bank-transfer-payment.dto";
import { CommissionBypassEscalationService } from "../commission-bypass/commission-bypass-escalation.service";

// Quality Audit 2026-08-23, finding #12 — Set<InvoiceStatus> explicite (pas
// Set<string> inféré) : une faute de frappe ici (ex. "partialy_paid") compilait
// sans erreur, rejetant silencieusement un paiement légitime sur une facture
// réellement partially_paid — bug détectable seulement par un test explicite
// couvrant cette valeur précise. `as const` requis pour que TS infère un tuple
// de littéraux plutôt que string[] avant de vérifier contre InvoiceStatus.
const PAYABLE_STATUSES = new Set<InvoiceStatus>(["issued", "partially_paid"] as const);

// Fenêtre glissante pour la détection de boucle client/montant (G1, ADR-032).
const STRUCTURING_LOOP_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly paymentLinkClient: PaymentLinkClient,
    private readonly commissionBypassEscalation: CommissionBypassEscalationService,
  ) {}

  async recordCashPayment(
    invoiceId: string,
    organizationId: string,
    dto: CreatePaymentDto,
    idempotencyKey: string,
  ) {
    const existing = await this.findByIdempotencyKey(organizationId, idempotencyKey);
    if (existing) {
      return existing;
    }

    // allowOverpayment: true — trop-perçu cash uniquement (C14, backlog explicite),
    // jamais pour recordProviderPayment() (lien généré pour un montant exact).
    const invoice = await this.getPayableInvoiceOrThrow(invoiceId, organizationId, dto.amount, true);
    await this.assertCashProofRequirement(invoice.organizationId, dto);

    const payment = await this.createPaymentAndApply(invoiceId, organizationId, idempotencyKey, dto.amount, {
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
    await this.regenerateLinkForRemainingBalance(invoiceId, organizationId);

    return payment;
  }

  // Appelé exclusivement par money-api après confirmation webhook (ADR-075) —
  // providerRef sert déjà de clé d'idempotence naturelle, pas de header client.
  // Aucune détection d'anomalie ici (G1/G3) : le moteur (détecté et étendu par
  // G3, ADR-091, voir detectAndRecordCashAnomaly()) reste strictement cash-only.
  // Gap toujours ouvert (non traité par G3) : "écart MM vs facturé" nécessiterait
  // une corrélation avec le Money Context (confirmation webhook réelle vs montant
  // facturé), jamais construite dans ce repo — signal distinct de ceux ajoutés
  // par G3 (récurrence sous seuil, chute du ratio non-cash), qui restent tous les
  // deux calculables à partir des seules données Trust déjà en base.
  // ADR-074, grille 5 paliers : dto.amountGnf (ce que le payeur a réglé) inclut
  // désormais structurellement la commission majorée au moment de la génération
  // du lien (voir invoices.service.ts:issue()/regeneratePaymentLink(),
  // regenerateLinkForRemainingBalance() ci-dessous) — il dépasse donc toujours
  // invoice.amountDue, légitimement. allowOverpayment: true contourne la
  // comparaison stricte de getPayableInvoiceOrThrow() (devenue obsolète pour ce
  // chemin), MAIS jamais dto.amountGnf n'est appliqué à l'invoice : seul
  // invoice.amountDue exact l'est (ci-dessous), donc le mécanisme trop-perçu C14
  // (overpaymentAmount) ne peut structurellement pas s'activer par erreur —
  // ADR-059 "montant certifié jamais pollué" reste intact.
  //
  // RLS (ADR-111 étape 1) — SEUL chemin du module sans RolesGuard (@Public() +
  // InternalAuthGuard) : aucune organisation n'est résolue pour nous, on la
  // DÉCOUVRE depuis la facture avant de poser le moindre GUC. Tout ce qui suit
  // cette résolution est scopé comme les chemins humains.
  async recordProviderPayment(invoiceId: string, dto: ConfirmProviderPaymentDto) {
    const organizationId = await this.resolveOrganizationIdFromInvoice(invoiceId);
    const idempotencyKey = dto.providerRef;
    const existing = await this.findByIdempotencyKey(organizationId, idempotencyKey);
    if (existing) {
      return existing;
    }

    const invoice = await this.getPayableInvoiceOrThrow(invoiceId, organizationId, dto.amountGnf, true);
    const organization = await organizationScopedClient(this.prisma, organizationId).organization.findFirstOrThrow({
      where: { id: invoice.organizationId },
    });
    const netAmount = invoice.amountDue;
    const platformFeeAmount = computePlatformFee(netAmount, organization.commercialTier);

    return this.createPaymentAndApply(invoiceId, organizationId, idempotencyKey, netAmount, {
      amount: netAmount,
      amountCollected: dto.amountGnf,
      platformFeeAmount,
      gatewayFeeAmount: dto.feeGatewayGnf,
      method: "payment_link",
      providerRef: dto.providerRef,
    });
  }

  // ADR-052, C3 — "rapprochement asynchrone" : enregistrement manuel par le staff
  // après constat sur son propre relevé bancaire, aucune confirmation automatique.
  // Contrairement au cash (C14), le trop-perçu n'est pas géré ici : un virement
  // arrive à un montant convenu à l'avance, pas de rendu-monnaie physique qui
  // justifierait cette gestion. Aucune preuve requise (contrairement au cash,
  // C1) : le relevé bancaire de l'organisation est déjà la preuve. Aucune
  // détection d'anomalie (G1) : ce moteur reste strictement cash-only.
  async recordBankTransferPayment(
    invoiceId: string,
    organizationId: string,
    dto: CreateBankTransferPaymentDto,
    idempotencyKey: string,
  ) {
    const existing = await this.findByIdempotencyKey(organizationId, idempotencyKey);
    if (existing) {
      return existing;
    }

    await this.getPayableInvoiceOrThrow(invoiceId, organizationId, dto.amount);

    const payment = await this.createPaymentAndApply(invoiceId, organizationId, idempotencyKey, dto.amount, {
      amount: dto.amount,
      amountCollected: dto.amount,
      platformFeeAmount: 0n,
      gatewayFeeAmount: 0n,
      method: "bank_transfer",
    });

    await this.regenerateLinkForRemainingBalance(invoiceId, organizationId);

    return payment;
  }

  // ADR-064 : un proforma n'accepte QUE des arrhes, jamais un paiement normal —
  // jamais appliqué à Invoice.amountPaid/amountDue (l'arrhes est un dépôt de
  // sécurité indépendant du solde de la facture, pas un règlement partiel).
  async recordDepositPayment(
    proformaId: string,
    organizationId: string,
    dto: RecordDepositDto,
    idempotencyKey: string,
  ) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const existing = await this.findByIdempotencyKey(organizationId, idempotencyKey);
    if (existing) {
      return existing;
    }

    const proforma = await scoped.invoice.findFirst({ where: { id: proformaId, organizationId } });
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

    const existingDeposit = await scoped.payment.findFirst({
      where: { invoiceId: proformaId, depositType: "arrhes" },
    });
    if (existingDeposit) {
      throw new ConflictException(`Proforma ${proformaId} a déjà une arrhes enregistrée`);
    }

    await this.assertCashProofRequirement(proforma.organizationId, dto);

    try {
      return await scoped.payment.create({
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
      return this.resolveIdempotencyRace(error, idempotencyKey, organizationId);
    }
  }

  // `payment` n'a pas d'organization_id : sa politique RLS passe par invoice_id
  // (voir la migration, liste des « tables indirectes »). Le `where` ne peut donc
  // PAS porter la colonne de scope — le GUC est ici la seule barrière, et elle ne
  // mordra qu'à l'étape 2. Centralisé pour que ce fait se lise en un seul endroit.
  private async findByIdempotencyKey(organizationId: string, idempotencyKey: string) {
    return organizationScopedClient(this.prisma, organizationId).payment.findFirst({
      where: { idempotencyKey },
    });
  }

  // Résolution du scope pour le SEUL appelant qui n'en a pas (webhook money-api).
  // Lecture NON scopée à dessein : c'est précisément le scope qu'on cherche —
  // le scoper serait l'œuf et la poule. L'autorisation vient d'InternalAuthGuard,
  // jamais de cette lecture. select minimal : rien d'autre n'est exposé.
  private async resolveOrganizationIdFromInvoice(invoiceId: string): Promise<string> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId },
      select: { organizationId: true },
    });
    if (!invoice) {
      throw new NotFoundException(`Facture ${invoiceId} introuvable`);
    }
    return invoice.organizationId;
  }

  private async getPayableInvoiceOrThrow(
    invoiceId: string,
    organizationId: string,
    amount: bigint,
    allowOverpayment = false,
  ) {
    const invoice = await organizationScopedClient(this.prisma, organizationId).invoice.findFirst({
      where: { id: invoiceId, organizationId },
    });
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

  // G3, ADR-091 — la règle vivait dans le refine() Zod de create-payment.dto.ts/
  // record-deposit.dto.ts (seuil global figé) ; elle vit ici désormais pour
  // pouvoir lire un seuil abaissé par organisation (Niveau 2 de l'escalade,
  // Organization.commissionBypassProofThresholdOverrideGnf). Comportement HTTP
  // légèrement changé (documenté, pas une régression silencieuse) : le corps
  // d'erreur passe d'un objet Zod flatten() à un message plat, le code 400 est
  // préservé.
  private async assertCashProofRequirement(
    organizationId: string,
    dto: {
      amount: bigint;
      proofPhotoUrl?: string;
      proofGpsLat?: number;
      proofGpsLng?: number;
      proofSignature?: string;
    },
  ) {
    const organization = await organizationScopedClient(this.prisma, organizationId).organization.findFirstOrThrow({
      where: { id: organizationId },
    });
    const effectiveThresholdGnfCentimes =
      organization.commissionBypassProofThresholdOverrideGnf ?? CASH_PROOF_THRESHOLD_GNF_CENTIMES;

    const met = isCashProofRequirementMet({
      amount: dto.amount,
      effectiveThresholdGnfCentimes,
      proofPhotoUrl: dto.proofPhotoUrl,
      proofGpsLat: dto.proofGpsLat,
      proofGpsLng: dto.proofGpsLng,
      proofSignature: dto.proofSignature,
    });
    if (!met) {
      throw new BadRequestException(
        "Photo, GPS et signature obligatoires pour un encaissement cash au-delà du seuil de preuve en vigueur pour cette organisation",
      );
    }
  }

  private async createPaymentAndApply(
    invoiceId: string,
    organizationId: string,
    idempotencyKey: string,
    amount: bigint,
    paymentData: Omit<Prisma.PaymentUncheckedCreateInput, "invoiceId" | "status" | "idempotencyKey">,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Transaction interactive : le client scopé ne convient pas ici (chaque
        // opération y ouvrirait sa propre transaction). Le GUC est posé en
        // PREMIÈRE ligne, il couvre tout le reste du bloc — création du paiement
        // ET application à la facture.
        await setOrganizationScope(tx, organizationId);
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
      return this.resolveIdempotencyRace(error, idempotencyKey, organizationId);
    }
  }

  // G1/G3, ADR-032/ADR-091 — "revue humaine systématique", jamais un rejet
  // automatique. Meilleur effort, HORS de la transaction de paiement (revue
  // sécurité) : même principe que PaymentLinkClient.tryGenerate() / le try/catch
  // autour du lien de paiement dans invoices.service.ts:issue() — un bug dans
  // cette détection annexe ne doit jamais faire échouer un encaissement cash déjà
  // légitimement committé. Gap toujours ouvert (non traité) : signal sectoriel/
  // quartier d'ADR-091, aucune donnée de secteur/quartier n'existe dans ce repo —
  // voir PLAN "Alternatives écartées".
  private async detectAndRecordCashAnomaly(
    invoice: { id: string; organizationId: string; customerId: string | null },
    amount: bigint,
  ) {
    try {
      const scoped = organizationScopedClient(this.prisma, invoice.organizationId);
      let sameAmountRecentCount = 1; // ce paiement inclus

      // Sans customerId, aucune boucle attribuable à un client identifié —
      // limitation documentée (Invoice.customerId n'a pas de modèle Customer associé).
      if (invoice.customerId) {
        sameAmountRecentCount = await scoped.payment.count({
          where: {
            method: "cash",
            amount,
            collectedAt: { gte: new Date(Date.now() - STRUCTURING_LOOP_WINDOW_MS) },
            invoice: { organizationId: invoice.organizationId, customerId: invoice.customerId },
          },
        });
      }

      // G3, ADR-091 — seuil effectif de l'organisation (même résolution
      // qu'assertCashProofRequirement, volontairement dupliquée : les deux
      // méthodes restent découplées, voir blueprint Décision C).
      const organization = await scoped.organization.findFirstOrThrow({
        where: { id: invoice.organizationId },
      });
      const effectiveProofThreshold =
        organization.commissionBypassProofThresholdOverrideGnf ?? CASH_PROOF_THRESHOLD_GNF_CENTIMES;

      // Récurrence org-wide (jamais par client, contrairement à sameAmountRecentCount
      // ci-dessus) de montants cash juste sous le seuil effectif — ne vaut la peine
      // d'être interrogée que si CE paiement est lui-même dans la bande.
      const band = (effectiveProofThreshold * 10n) / 100n;
      const bandFloor = effectiveProofThreshold - band;
      let sameOrgSubThresholdRecentCount = 0;
      if (amount >= bandFloor && amount < effectiveProofThreshold) {
        // Compte CE paiement (déjà committé par createPaymentAndApply() ci-dessus,
        // donc déjà dans la fenêtre) — même précédent que sameAmountRecentCount
        // au-dessus ("ce paiement inclus", G1) : le seuil de récurrence (3) reste
        // cohérent avec cette convention déjà établie.
        sameOrgSubThresholdRecentCount = await scoped.payment.count({
          where: {
            method: "cash",
            amount: { gte: bandFloor, lt: effectiveProofThreshold },
            collectedAt: { gte: new Date(Date.now() - STRUCTURING_LOOP_WINDOW_MS) },
            invoice: { organizationId: invoice.organizationId },
          },
        });
      }

      const patterns: (CashAnomalyPattern | "non_cash_ratio_drop")[] = detectCashAnomalyPatterns({
        amount,
        sameAmountRecentCount,
        effectiveProofThreshold,
        sameOrgSubThresholdRecentCount,
      });

      // G3, ADR-091 — chute brutale du ratio non-cash, org-wide, deux fenêtres
      // glissantes consécutives de RATIO_WINDOW_DAYS. null (aucun paiement sur une
      // fenêtre) = signal ignoré, jamais un faux positif sur une organisation neuve.
      const now = Date.now();
      const windowMs = RATIO_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const recentNonCashRatio = await this.computeNonCashRatio(
        invoice.organizationId,
        new Date(now - windowMs),
        new Date(now),
      );
      const priorNonCashRatio = await this.computeNonCashRatio(
        invoice.organizationId,
        new Date(now - 2 * windowMs),
        new Date(now - windowMs),
      );
      if (
        recentNonCashRatio !== null &&
        priorNonCashRatio !== null &&
        detectNonCashRatioDrop({ priorNonCashRatio, recentNonCashRatio })
      ) {
        patterns.push("non_cash_ratio_drop");
      }

      if (patterns.length === 0) {
        return;
      }

      await scoped.invoiceEvent.create({
        data: {
          invoiceId: invoice.id,
          type: "suspicious_cash_pattern_detected",
          actorId: null,
          amount,
          metadata: { patterns },
        },
      });

      await this.commissionBypassEscalation.evaluateAndEscalate(invoice.organizationId, patterns);
    } catch (error) {
      this.logger.warn(
        `Paiement cash sur la facture ${invoice.id} enregistré, mais la détection d'anomalie a échoué : ${(error as Error).message}`,
      );
    }
  }

  // G3, ADR-091 — null si aucun paiement sur la fenêtre (organisation neuve ou
  // inactive), jamais 0/0 : le signal de chute doit rester silencieux plutôt que
  // de produire un ratio artificiel.
  private async computeNonCashRatio(
    organizationId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<number | null> {
    // `invoice: { organizationId }` conservé : payment est sous RLS par
    // indirection, cette jointure EST la garde explicite tant que le GUC dort.
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const total = await scoped.payment.count({
      where: { invoice: { organizationId }, collectedAt: { gte: windowStart, lt: windowEnd } },
    });
    if (total === 0) {
      return null;
    }
    const nonCash = await scoped.payment.count({
      where: {
        invoice: { organizationId },
        collectedAt: { gte: windowStart, lt: windowEnd },
        method: { not: "cash" },
      },
    });
    return nonCash / total;
  }

  // C11, ADR-062 — "nouveau lien pour le solde restant". Meilleur effort, HORS de
  // la transaction de paiement (même précédent que detectAndRecordCashAnomaly(),
  // G1) : un échec ici ne doit jamais faire échouer un encaissement déjà
  // légitimement committé. amountGnf: invoice.amountDue (jamais totalTtc, même
  // fix que regeneratePaymentLink() ci-dessus) — le client doit voir le solde
  // RÉELLEMENT restant, pas le total original. Volontairement PAS appelée depuis
  // recordProviderPayment() : un paiement partiel via lien déjà en cours est un
  // cas marginal, régénérer juste après un webhook de confirmation serait redondant.
  private async regenerateLinkForRemainingBalance(invoiceId: string, organizationId: string) {
    try {
      const scoped = organizationScopedClient(this.prisma, organizationId);
      const invoice = await scoped.invoice.findFirst({ where: { id: invoiceId, organizationId } });
      if (!invoice || invoice.status !== "partially_paid") {
        return;
      }

      // Majoré de la commission (ADR-074) — même précédent que issue()/
      // regeneratePaymentLink() (invoices.service.ts).
      const organization = await scoped.organization.findFirstOrThrow({
        where: { id: invoice.organizationId },
      });
      const platformFee = computePlatformFee(invoice.amountDue, organization.commercialTier);

      const paymentLink = await this.paymentLinkClient.tryGenerate({
        invoiceId: invoice.id,
        organizationId: invoice.organizationId,
        amountGnf: invoice.amountDue + platformFee,
      });
      if (!paymentLink) {
        return;
      }

      // Transaction requise (même précédent que regeneratePaymentLink(), C18) :
      // jamais un lien mis à jour sans sa trace d'audit correspondante. updateMany
      // (pas update) réclame atomiquement sur status="partially_paid" au moment de
      // l'écriture — même précédent que convertToInvoice()/forfeitDeposit() : entre
      // la lecture initiale et la fin de l'appel money-api (jusqu'à 3s), un autre
      // paiement concurrent a pu solder la facture. count=0 → jamais un lien écrit
      // pour un montant qui n'est déjà plus dû, jamais une trace d'audit mensongère
      // (revue résilience, C11).
      await this.prisma.$transaction(async (tx) => {
        // Même discipline que createPaymentAndApply() : GUC en première ligne,
        // il couvre la revendication ET la trace d'audit.
        await setOrganizationScope(tx, organizationId);
        const claimed = await tx.invoice.updateMany({
          where: { id: invoiceId, organizationId, status: "partially_paid" },
          data: {
            paymentLinkUrl: paymentLink.paymentLinkUrl,
            paymentLinkId: paymentLink.providerRef,
            paymentLinkExpiresAt: paymentLink.expiresAt,
          },
        });
        if (claimed.count === 0) {
          return;
        }
        await tx.invoiceEvent.create({
          data: { invoiceId, type: "payment_link_regenerated", actorId: null },
        });
      });
    } catch (error) {
      this.logger.warn(
        `Facture ${invoiceId} : régénération best-effort du lien de paiement après paiement partiel a échoué : ${(error as Error).message}`,
      );
    }
  }

  // Course concurrente : deux requêtes avec le même Idempotency-Key arrivent en
  // parallèle, toutes deux passent le lookup initial avant que l'une des deux ne
  // committe — la contrainte unique DB tranche, on renvoie le paiement gagnant
  // plutôt qu'un 500 brut sur la requête perdante. Partagé entre createPaymentAndApply()
  // et recordDepositPayment() — un seul endroit à maintenir pour ce comportement.
  private async resolveIdempotencyRace(error: unknown, idempotencyKey: string, organizationId: string) {
    if (isUniqueConstraintViolation(error, "idempotency_key")) {
      const winner = await this.findByIdempotencyKey(organizationId, idempotencyKey);
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
  //
  // RLS — appelée UNIQUEMENT depuis createPaymentAndApply(), dont la transaction
  // pose le GUC en première ligne : ces update() en héritent. Ils restent des
  // update() (pas des updateMany() scopés) parce que le code lit la ligne
  // retournée pour décider du statut — la facture a de toute façon été lue
  // scopée par getPayableInvoiceOrThrow() avant d'arriver ici.
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
