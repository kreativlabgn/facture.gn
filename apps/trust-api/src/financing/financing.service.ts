import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { financeableInvoiceWhere, isFinanceable } from "./is-financeable";
import type { ChooseFinancingDto } from "./dto/choose-financing.dto";

// RLS (ADR-111 étape 1) — CARTE DU MODULE. `invoice` porte organization_id en
// direct, `invoice_event` l'a par indirection : les deux sont scopés.
//
// Reste GLOBAL : `financial_partner`. Cette table est HORS RLS (vérifié : aucune
// ENABLE ROW LEVEL SECURITY) et c'est cohérent — un partenaire financier est un
// acteur de la PLATEFORME, il n'appartient à aucune PME. Le scoper ne
// durcirait rien et viderait la liste des rails de financement.
//
// `organizationId` vient du RolesGuard : les routes sont sous /invoices/:id sans
// @OrganizationIdSource, donc la résolution "invoice" par défaut s'applique — le
// guard a déjà résolu l'organisation émettrice et vérifié l'appartenance.
@Injectable()
export class FinancingService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // K4, ADR-088 — Rail A/B affichés côté PWA à partir d'ici. Rail B n'a pas de
  // donnée dédiée (absence d'action, voir PLAN) : seule l'éligibilité et la
  // liste des partenaires Rail A sont retournées.
  async getFinancingOptions(invoiceId: string, organizationId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const invoice = await scoped.invoice.findFirstOrThrow({
      where: { id: invoiceId, organizationId },
      include: { customer: { include: { publicBuyerAccount: true } } },
    });
    const financeable = isFinanceable({
      ...invoice,
      publicBuyerAccountVerified: invoice.customer?.publicBuyerAccount?.verificationStatus === "verified",
      // Security Audit 2026-08-23, revue post-fix #1 — voir is-financeable.ts.
      publicEntityConfirmed: invoice.customer?.isPublicEntityConfirmed === true,
    });
    const partners = financeable
      ? // Annuaire PLATEFORME, hors RLS — voir la carte en tête de classe.
        await this.prisma.financialPartner.findMany({ where: { status: "active" } })
      : [];
    return { financeable, partners };
  }

  // K4/K5 — garde de concurrence par transaction (même pattern que
  // resolveCreditLimitRequest, E5) : la vérification is_financeable() en amont
  // ne protège pas contre deux demandes concurrentes, seule la clause where de
  // l'updateMany le fait réellement. Aucune exécution réelle Djomy Payout/
  // bank_transfer (aucune intégration dans ce repo, même limite déjà
  // documentée par refunds.service.ts et RevenueShareService).
  async chooseFinancing(
    invoiceId: string,
    dto: ChooseFinancingDto,
    requesterUserId: string,
    organizationId: string,
  ) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const invoice = await scoped.invoice.findFirstOrThrow({
      where: { id: invoiceId, organizationId },
      include: { customer: { include: { publicBuyerAccount: true } } },
    });
    const financeable = isFinanceable({
      ...invoice,
      publicBuyerAccountVerified: invoice.customer?.publicBuyerAccount?.verificationStatus === "verified",
      // Security Audit 2026-08-23, revue post-fix #1 — voir is-financeable.ts.
      publicEntityConfirmed: invoice.customer?.isPublicEntityConfirmed === true,
    });
    if (!financeable) {
      throw new ConflictException(`Facture ${invoiceId} non finançable`);
    }

    // Annuaire PLATEFORME, hors RLS : lecture globale à dessein.
    const partner = await this.prisma.financialPartner.findUnique({ where: { id: dto.financialPartnerId } });
    if (!partner || partner.status !== "active") {
      throw new ConflictException(`Partenaire financier ${dto.financialPartnerId} introuvable ou inactif`);
    }

    const financedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      // GUC en première ligne : il couvre la revendication de la facture et sa
      // trace d'audit.
      await setOrganizationScope(tx, organizationId);

      const claimed = await tx.invoice.updateMany({
        where: { ...financeableInvoiceWhere(invoiceId), organizationId },
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
