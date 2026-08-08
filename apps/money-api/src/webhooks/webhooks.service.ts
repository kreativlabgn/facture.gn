import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Prisma, PaymentProviderName, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { ProviderResolverService } from "../payment-orchestrator/provider-resolver.service";
import { PaymentConfirmationClient } from "./payment-confirmation-client";

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly providerResolver: ProviderResolverService,
    private readonly confirmationClient: PaymentConfirmationClient,
  ) {}

  async handleIncomingWebhook(providerName: PaymentProviderName, rawPayload: unknown): Promise<void> {
    const provider = this.providerResolver.resolve(providerName);
    if (!provider) {
      throw new BadRequestException(`Provider ${providerName} inconnu ou pas encore implémenté`);
    }

    const normalized = provider.handleWebhook(rawPayload);
    if (!normalized.signatureValid) {
      throw new UnauthorizedException("Signature webhook invalide");
    }

    const alreadyProcessed = await this.prisma.paymentWebhook.findUnique({
      where: { provider_providerRef: { provider: providerName, providerRef: normalized.providerRef } },
    });
    if (alreadyProcessed) {
      return; // ADR-075 : un webhook reçu deux fois n'est traité qu'une seule fois.
    }

    const attempt = await this.prisma.paymentProviderAttempt.findFirst({
      where: { provider: providerName, providerRef: normalized.providerRef },
    });
    if (!attempt) {
      throw new BadRequestException(
        `Aucune tentative de paiement connue pour providerRef=${normalized.providerRef}`,
      );
    }

    if (normalized.status === "paid") {
      // Jamais catché ici — un échec doit remonter jusqu'au contrôleur pour qu'il
      // réponde en erreur au fournisseur (redélivraison attendue), pas être avalé.
      // L'insertion de PaymentWebhook n'a lieu qu'APRÈS ce succès (voir plus bas) :
      // jamais un état à moitié traité.
      await this.confirmationClient.confirm({
        invoiceId: attempt.invoiceId,
        amountGnf: attempt.amountGnf,
        provider: providerName,
        providerRef: normalized.providerRef,
        feeGatewayGnf: attempt.feeGateway,
      });
    }

    try {
      await this.prisma.paymentWebhook.create({
        data: {
          provider: providerName,
          providerRef: normalized.providerRef,
          payload: rawPayload as Prisma.InputJsonValue,
          normalizedStatus: normalized.status,
          signatureValid: normalized.signatureValid,
        },
      });
    } catch (error) {
      // Course concurrente : deux livraisons quasi simultanées du même webhook
      // passent toutes deux le lookup de dédoublonnage avant que l'une des deux ne
      // committe — la contrainte unique DB tranche, on ignore silencieusement
      // (l'autre a déjà tout traité), jamais un 500 brut.
      if (!isUniqueConstraintViolation(error, "provider_ref")) {
        throw error;
      }
    }
  }
}
