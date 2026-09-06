import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { computePlatformFee } from "../common/commission-grid";
import { InvoicesService } from "../invoices/invoices.service";

// D3, §2.1 Spec USSD — aucune nouvelle logique de paiement : délègue
// entièrement à InvoicesService.regeneratePaymentLink() (C18, déjà mergée,
// déjà utilisée par la PWA — "mêmes garanties que la PWA", texte backlog).
// Aucune capacité de charge directe n'existe dans ce repo (voir plan) : "le
// paiement est exécuté via le provider" est donc un lien (ré)généré, jamais
// une charge synchrone.
@Injectable()
export class UssdPaymentService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly invoicesService: InvoicesService,
  ) {}

  // Invoice.number n'est unique que par organisation — jamais une recherche
  // sans organizationId. Exclut paid/voided/draft : rien à payer.
  async findPayableInvoice(organizationId: string, number: string) {
    return organizationScopedClient(this.prisma, organizationId).invoice.findFirst({
      where: { organizationId, number, status: { in: ["issued", "partially_paid"] } },
    });
  }

  // Aperçu affiché AVANT confirmation (§2.1 : "frais affichés séparément") —
  // même calcul qu'InvoicesService.regeneratePaymentLink()/issue() (ADR-074),
  // jamais un montant deviné ni dupliqué autrement.
  async previewFee(organizationId: string, amountDue: bigint): Promise<bigint> {
    const organization = await organizationScopedClient(this.prisma, organizationId).organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    return computePlatformFee(amountDue, organization.commercialTier);
  }

  // Hors HTTP : aucun RolesGuard ne tourne, aucune organisation n'est résolue
  // pour nous. Elle vient du contexte de session, où elle a été posée à l'étape
  // de sélection de la facture — celle-là même qui a servi à la trouver
  // (findPayableInvoice), jamais une organisation redécouverte après coup.
  async confirmPayment(invoiceId: string, actorId: string, organizationId: string) {
    return this.invoicesService.regeneratePaymentLink(invoiceId, actorId, organizationId);
  }
}
