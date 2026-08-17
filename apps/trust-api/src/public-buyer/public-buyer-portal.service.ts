import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";

const DEFAULT_LIST_PAGE_SIZE = 50;
const MAX_LIST_PAGE_SIZE = 100;

@Injectable()
export class PublicBuyerPortalService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // J1, ADR-080/081/098 — Niveau 2 de la chaîne de validation B2G. Autorisation
  // ENTIÈREMENT inline ici, jamais via RolesGuard/@Roles() : un DAF n'est membre
  // d'aucune organisation PME, RolesGuard résoudrait la mauvaise identité (voir
  // PLAN, "Alternatives écartées"). Idempotent — un second appel sur une facture
  // déjà validée est un no-op, jamais un second InvoiceEvent (pas de mécanisme de
  // "dévalidation", cohérent avec le fait que la liquidation n'est jamais reprise).
  async validateLiquidation(invoiceId: string, requesterUserId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { customer: true },
    });

    const publicBuyerAccountId = invoice.customer?.publicBuyerAccountId;
    if (!publicBuyerAccountId) {
      throw new ForbiddenException(
        `Facture ${invoiceId} n'est rattachée à aucune entité publique — pas une facture B2G`,
      );
    }

    const membership = await this.prisma.publicBuyerAccountMember.findFirst({
      where: { publicBuyerAccountId, userId: requesterUserId },
    });
    if (!membership) {
      throw new ForbiddenException("Aucun accès à ce compte acheteur public");
    }

    if (invoice.validatedByAdministration) {
      return invoice;
    }

    if (invoice.status === "draft") {
      throw new ConflictException(
        `Facture ${invoiceId} encore en draft — jamais émise (issued), impossible de valider la liquidation`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: { validatedByAdministration: true },
      });

      await tx.invoiceEvent.create({
        data: { invoiceId, type: "liquidation_validated", actorId: requesterUserId },
      });

      return updated;
    });
  }

  // J2, ADR-080/098 — dashboard "encours fournisseurs". Membership résolu par
  // userId seul (un DAF n'appartient qu'à un seul public_buyer_account en V1,
  // aucun sélecteur multi-compte nécessaire) — même garde d'autorisation inline
  // que validateLiquidation(), jamais via RolesGuard.
  async listReceivedInvoices(requesterUserId: string, pagination: { take?: number; skip?: number }) {
    const membership = await this.prisma.publicBuyerAccountMember.findFirst({
      where: { userId: requesterUserId },
    });
    if (!membership) {
      throw new ForbiddenException("Aucun accès à un compte acheteur public");
    }

    const take = Math.min(pagination.take ?? DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
    const skip = pagination.skip ?? 0;
    const where = { customer: { publicBuyerAccountId: membership.publicBuyerAccountId } };

    const [invoices, aggregate] = await Promise.all([
      this.prisma.invoice.findMany({ where, orderBy: { issuedAt: "desc" }, take, skip }),
      this.prisma.invoice.aggregate({ where, _sum: { amountDue: true } }),
    ]);

    return { invoices, outstandingTotal: aggregate._sum.amountDue ?? 0n };
  }
}
