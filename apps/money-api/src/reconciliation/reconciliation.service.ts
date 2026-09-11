import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { ProviderResolverService } from "../payment-orchestrator/provider-resolver.service";
import { PaymentConfirmationClient } from "../webhooks/payment-confirmation-client";

const DEFAULT_STALE_MINUTES = 60;

export interface ReconciliationSummary {
  checked: number;
  confirmed: number;
  failed: number;
  stillPending: number;
  skipped: number;
  errored: number;
}

// Lot E, ADR-075 (complément) — réconciliation ACTIVE des tentatives de paiement
// dont le webhook s'est perdu. Complément du chemin nominal (webhook), jamais un
// remplacement : une panne Redis dégrade la réconciliation, jamais l'encaissement.
// Idempotence garantie côté trust-api par providerRef = Payment.idempotencyKey
// (ADR-076) — une course réconciliation × webhook ne produit jamais un double
// paiement.
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly providerResolver: ProviderResolverService,
    private readonly confirmationClient: PaymentConfirmationClient,
  ) {}

  async runOnce(): Promise<ReconciliationSummary> {
    const staleMinutes = Number(process.env.RECONCILIATION_STALE_MINUTES) || DEFAULT_STALE_MINUTES;
    const cutoff = new Date(Date.now() - staleMinutes * 60_000);

    const stale = await this.prisma.paymentProviderAttempt.findMany({
      where: {
        status: { in: ["pending", "timeout"] },
        createdAt: { lt: cutoff },
        providerRef: { not: null },
      },
    });

    const summary: ReconciliationSummary = {
      checked: stale.length,
      confirmed: 0,
      failed: 0,
      stillPending: 0,
      skipped: 0,
      errored: 0,
    };

    // Séquentiel + try/catch par itération : une API provider lente ou en panne
    // ne bloque jamais le traitement des autres tentatives (jamais Promise.all,
    // dont une rejection tuerait le lot). Un lot lent finit au prochain tick.
    for (const attempt of stale) {
      try {
        const provider = this.providerResolver.resolve(attempt.provider);
        if (!provider || !attempt.providerRef) {
          summary.skipped++;
          continue;
        }

        // Le webhook a peut-être été traité sans que l'attempt ne soit passée
        // success (la confirmation trust-api peut échouer). Si la ligne
        // PaymentWebhook existe déjà, le paiement est déjà enregistré côté
        // trust-api : on ne repasse pas par confirm().
        const alreadyWebhooked = await this.prisma.paymentWebhook.findUnique({
          where: { provider_providerRef: { provider: attempt.provider, providerRef: attempt.providerRef } },
        });
        if (alreadyWebhooked) {
          summary.skipped++;
          continue;
        }

        const result = await provider.verifyTransaction(attempt.providerRef);

        if (result.status === "success") {
          // Ordre CRUCIAL : confirmer trust-api AVANT de marquer l'attempt
          // success. Si trust-api est indisponible, l'attempt reste "pending" et
          // sera retentée au prochain tick — jamais un paiement provider avéré
          // qui ne se traduit pas dans la facture, sans plus aucune reprise.
          try {
            await this.confirmationClient.confirm({
              invoiceId: attempt.invoiceId,
              amountGnf: attempt.amountGnf,
              provider: attempt.provider,
              providerRef: attempt.providerRef,
              feeGatewayGnf: attempt.feeGateway,
            });
          } catch (error) {
            summary.errored++;
            this.logger.error(
              `Confirmation trust-api échouée pour ${attempt.providerRef} (attempt ${attempt.id}, laissée pending pour reprise) : ${(error as Error).message}`,
            );
            continue;
          }
          await this.prisma.paymentProviderAttempt.update({
            where: { id: attempt.id },
            data: { status: "success", settledAt: result.settledAt ?? new Date() },
          });
          summary.confirmed++;
        } else if (result.status === "failed") {
          await this.prisma.paymentProviderAttempt.update({
            where: { id: attempt.id },
            data: { status: "failed" },
          });
          summary.failed++;
        } else {
          summary.stillPending++;
        }
      } catch (error) {
        summary.errored++;
        this.logger.error(
          `Réconciliation de l'attempt ${attempt.id} échouée : ${(error as Error).message}`,
        );
      }
    }

    return summary;
  }
}
