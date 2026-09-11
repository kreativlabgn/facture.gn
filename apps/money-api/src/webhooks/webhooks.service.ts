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
    if (!normalized.providerRef) {
      throw new BadRequestException("Le payload webhook ne contient pas de providerRef");
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
      // La ligne de dédoublonnage est posée AVANT la confirmation : si celle-ci
      // échoue (trust-api hors ligne), la ligne est retirée et le fournisseur
      // redélivresse le webhook, qui repassera par le même chemin. Si la
      // confirmation réussit et que le processus crash avant la mise à jour,
      // la redélivraison trouve la ligne et saute : le paiement est déjà enregistré
      // côté trust-api, et la confirmation est idempote (ADR-076).
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
        // Course concurrente : une autre livraison a inséré la ligne en même
        // temps. Le paiement est déjà traité (ou en cours) — on ne repasse pas
        // par confirm(), jamais un double paiement.
        if (!isUniqueConstraintViolation(error, "provider_ref")) {
          throw error;
        }
        return;
      }
      try {
        await this.confirmationClient.confirm({
          invoiceId: attempt.invoiceId,
          amountGnf: attempt.amountGnf,
          provider: providerName,
          providerRef: normalized.providerRef,
          feeGatewayGnf: attempt.feeGateway,
        });
      } catch (error) {
        await this.prisma.paymentWebhook.delete({
          where: { provider_providerRef: { provider: providerName, providerRef: normalized.providerRef } },
        });
        throw error;
      }
      return;
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
      if (!isUniqueConstraintViolation(error, "provider_ref")) {
        throw error;
      }
    }
  }
}
