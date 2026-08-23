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
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

    // Requête séparée plutôt qu'un include — invoice ne porte jamais la relation
    // customer, sa forme reste identique que ce soit le premier appel ou un rejeu
    // idempotent (voir le retour ligne ~40 ci-dessous).
    const customer = invoice.customerId
      ? await this.prisma.customer.findUnique({ where: { id: invoice.customerId } })
      : null;

    const publicBuyerAccountId = customer?.publicBuyerAccountId;
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

    // Security Audit 2026-08-23, revue post-fix #1 (finding #1 CRITIQUE) — sans
    // cette garde, N'IMPORTE QUEL PublicBuyerAccount auto-créé en self-service
    // (statut "pending" par défaut, PublicBuyerAccountsService.create()) pouvait
    // valider sa propre liquidation : rien ne distinguait un compte réellement
    // institutionnel d'un faux compte créé par l'attaquant lui-même. Seul un
    // compte "verified" (bascule opérationnelle hors code, voir schema.prisma)
    // peut désormais produire une validation.
    const publicBuyerAccount = await this.prisma.publicBuyerAccount.findUniqueOrThrow({
      where: { id: publicBuyerAccountId },
    });
    if (publicBuyerAccount.verificationStatus !== "verified") {
      throw new ForbiddenException(
        `Compte acheteur public ${publicBuyerAccountId} non vérifié — impossible de valider une liquidation`,
      );
    }

    // Security Audit 2026-08-23, finding #13 — une PME peut rattacher un client à
    // N'IMPORTE QUEL compte acheteur public existant (flagPublicEntity() ne
    // vérifie que l'existence du compte, jamais son consentement). Sans cette
    // garde, un DAF pourrait valider par erreur la liquidation d'une facture d'un
    // fournisseur avec lequel son administration n'a aucune relation réelle.
    if (!customer?.isPublicEntityConfirmed) {
      throw new ForbiddenException(
        `Le rattachement du client de la facture ${invoiceId} à ce compte acheteur public n'a pas été confirmé`,
      );
    }

    if (invoice.validatedByAdministration) {
      return invoice;
    }

    if (invoice.status === "draft") {
      throw new ConflictException(
        `Facture ${invoiceId} encore en draft — jamais émise (issued), impossible de valider la liquidation`,
      );
    }

    // PRD §4.2 — voided réservé aux factures sans aucun paiement : aucune dette réelle à
    // liquider, jamais une simple variante de "issued" à laisser passer par défaut.
    if (invoice.status === "voided") {
      throw new ConflictException(`Facture ${invoiceId} annulée (voided) — aucune dette à liquider`);
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
    // draft exclu : jamais "reçue" tant que la PME ne l'a pas émise. voided exclu : plus
    // aucune dette réelle (PRD §4.2, amountDue n'est jamais remis à zéro au void()) —
    // sans ce filtre, l'encours total intègrerait des créances annulées.
    // Security Audit 2026-08-23, finding #13 — isPublicEntityConfirmed: true
    // exclut les liens jamais confirmés par ce compte acheteur public, même précédent
    // que la garde ajoutée à validateLiquidation() ci-dessus.
    const where = {
      customer: { publicBuyerAccountId: membership.publicBuyerAccountId, isPublicEntityConfirmed: true },
      status: { notIn: ["draft", "voided"] as Array<"draft" | "voided"> },
    };

    const [invoices, aggregate] = await Promise.all([
      this.prisma.invoice.findMany({ where, orderBy: { issuedAt: "desc" }, take, skip }),
      this.prisma.invoice.aggregate({ where, _sum: { amountDue: true } }),
    ]);

    return { invoices, outstandingTotal: aggregate._sum.amountDue ?? 0n };
  }

  // Security Audit 2026-08-23, finding #13 — seule façon de faire passer
  // Customer.isPublicEntityConfirmed à true : un membre (public_buyer_validator)
  // du COMPTE CIBLÉ par le lien doit explicitement le confirmer, jamais la PME qui
  // l'a posé (flagPublicEntity()). Même autorisation inline que
  // validateLiquidation()/listReceivedInvoices() ci-dessus — jamais RolesGuard.
  async confirmCustomerLink(customerId: string, requesterUserId: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    if (!customer.publicBuyerAccountId) {
      throw new ForbiddenException(`Client ${customerId} n'est rattaché à aucun compte acheteur public`);
    }

    const membership = await this.prisma.publicBuyerAccountMember.findFirst({
      where: { publicBuyerAccountId: customer.publicBuyerAccountId, userId: requesterUserId },
    });
    if (!membership) {
      throw new ForbiddenException("Aucun accès à ce compte acheteur public");
    }

    return this.prisma.customer.update({
      where: { id: customerId },
      data: { isPublicEntityConfirmed: true },
    });
  }
}
