import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { financeableInvoiceWhere, isFinanceable } from "./is-financeable";
import type { ChooseFinancingDto } from "./dto/choose-financing.dto";

@Injectable()
export class FinancingService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // K4, ADR-088 — Rail A/B affichés côté PWA à partir d'ici. Rail B n'a pas de
  // donnée dédiée (absence d'action, voir PLAN) : seule l'éligibilité et la
  // liste des partenaires Rail A sont retournées.
  async getFinancingOptions(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const financeable = isFinanceable(invoice);
    const partners = financeable
      ? await this.prisma.financialPartner.findMany({ where: { status: "active" } })
      : [];
    return { financeable, partners };
  }

  // K4/K5 — garde de concurrence par transaction (même pattern que
  // resolveCreditLimitRequest, E5) : la vérification is_financeable() en amont
  // ne protège pas contre deux demandes concurrentes, seule la clause where de
  // l'updateMany le fait réellement. Aucune exécution réelle Djomy Payout/
  // bank_transfer (aucune intégration dans ce repo, même limite déjà
  // documentée par refunds.service.ts et RevenueShareService).
  async chooseFinancing(invoiceId: string, dto: ChooseFinancingDto, requesterUserId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (!isFinanceable(invoice)) {
      throw new ConflictException(`Facture ${invoiceId} non finançable`);
    }

    const partner = await this.prisma.financialPartner.findUnique({ where: { id: dto.financialPartnerId } });
    if (!partner || partner.status !== "active") {
      throw new ConflictException(`Partenaire financier ${dto.financialPartnerId} introuvable ou inactif`);
    }

    const financedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invoice.updateMany({
        where: financeableInvoiceWhere(invoiceId),
        data: { financedByPartnerId: dto.financialPartnerId, financedAt },
      });
      if (claimed.count === 0) {
        throw new ConflictException(`Facture ${invoiceId} déjà financée`);
      }

      await tx.invoiceEvent.create({
        data: {
          invoiceId,
          type: "financing_disbursed",
          actorId: requesterUserId,
          amount: invoice.totalTtc,
          metadata: { financialPartnerId: dto.financialPartnerId, disbursementMethod: dto.disbursementMethod },
        },
      });

      return { ...invoice, financedByPartnerId: dto.financialPartnerId, financedAt };
    });
  }
}
