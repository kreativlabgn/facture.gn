import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { PaymentProviderRegistryService } from "../payment-orchestrator/provider-registry.service";
import type { CreatePaymentLinkResult } from "../payment-orchestrator/provider.interface";

export interface PublicCheckout {
  provider: string;
  paymentLinkUrl: string | null;
  /** ATTENTION — ce n'est PAS le prix de la marchandise. InvoicesService.issue()
   *  transmet `totalTtc + platformFee` : ce montant porte déjà la commission
   *  facture.gn. Le prix de la marchandise vaut `amountGnf - feePlatformGnf`. */
  amountGnf: bigint;
  feeGatewayGnf: bigint;
  /** Commission facture.gn effectivement prélevée sur cette tentative (ADR-074).
   *  Déjà persistée depuis l'origine ; elle n'était simplement pas exposée, ce
   *  qui laissait le payeur devant un « Montant de la facture » qui n'en était
   *  pas un — la marchandise et notre commission y étaient fondues. */
  feePlatformGnf: bigint;
  expiresAt: Date | null;
}

@Injectable()
export class PaymentLinksService {
  constructor(
    private readonly registry: PaymentProviderRegistryService,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  createPaymentLink(invoiceId: string, organizationId: string, amountGnf: bigint): Promise<CreatePaymentLinkResult> {
    return this.registry.resolve({ invoiceId, organizationId, amountGnf });
  }

  // C19 — champs strictement destinés au payeur, jamais invoiceId/organizationId
  // (déjà connus via le lien détenu, pas une fuite mais pas un ajout nécessaire).
  // Toujours la tentative "success" la plus récente — un seul provider gagne
  // normalement, orderBy+findFirst reste déterministe dans le cas contraire.
  async getPublicCheckout(invoiceId: string): Promise<PublicCheckout> {
    const attempt = await this.prisma.paymentProviderAttempt.findFirst({
      where: { invoiceId, status: "success" },
      orderBy: { createdAt: "desc" },
    });
    if (!attempt) {
      throw new NotFoundException(`Aucun lien de paiement actif pour la facture ${invoiceId}`);
    }

    return {
      provider: attempt.provider,
      paymentLinkUrl: attempt.paymentLinkUrl,
      amountGnf: attempt.amountGnf,
      feeGatewayGnf: attempt.feeGateway,
      feePlatformGnf: attempt.feePlatform,
      expiresAt: attempt.expiresAt,
    };
  }
}
