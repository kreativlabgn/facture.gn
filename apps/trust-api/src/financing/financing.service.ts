import { ConflictException, Inject, Injectable, PreconditionFailedException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { financeableInvoiceWhere, isFinanceable, motifCreanceNonCessible } from "./is-financeable";
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
// Codes d'erreur métier du rail de financement. Stables et distincts du
// message : un partenaire qui automatise ses reprises doit pouvoir brancher
// dessus sans lire du français, et distinguer « réessaie plus tard » d'un refus
// que rien ne rattrapera.
const MOTIF_HTTP_CODE = {
  deja_encaissee: "FINANCING_INVOICE_ALREADY_SETTLED",
  en_litige: "FINANCING_INVOICE_DISPUTED",
} as const;

const MOTIF_MESSAGE = {
  deja_encaissee: (id: string) =>
    `Facture ${id} déjà encaissée : la créance est éteinte, elle ne peut plus être cédée`,
  en_litige: (id: string) =>
    `Facture ${id} sous litige actif : la créance ne peut pas être cédée tant que le montant est contesté`,
} as const;

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
      include: {
        customer: { include: { publicBuyerAccount: true } },
        // K5 — le NOM du cessionnaire, et rien d'autre. Une créance cédée est
        // définitivement cédée : l'écran de la PME doit pouvoir nommer
        // l'établissement qui l'a rachetée, or `financeable` retombe à false
        // dès la cession et la liste `partners` se vide — le nom ne pouvait
        // donc plus venir de nulle part, et l'appelant en était réduit à
        // afficher un uuid.
        //
        // `select` explicite, jamais `include` seul : financial_partner porte
        // `apiKey`, qui n'a rien à faire dans une réponse HTTP (même
        // discipline que le select d'InvoicesService.findOne sur user).
        financedByPartner: { select: { id: true, name: true } },
      },
    });
    const financeable = isFinanceable({
      ...invoice,
      publicBuyerAccountVerified: invoice.customer?.publicBuyerAccount?.verificationStatus === "verified",
      // Security Audit 2026-08-23, revue post-fix #1 — voir is-financeable.ts.
      publicEntityConfirmed: invoice.customer?.isPublicEntityConfirmed === true,
    });
    const partners = financeable
      ? // Annuaire PLATEFORME, hors RLS — voir la carte en tête de classe.
        //
        // `select` explicite : sans lui, cette réponse HTTP embarquait la ligne
        // financial_partner ENTIÈRE, `apiKey` compris — le secret d'appel du
        // partenaire, servi à l'owner/admin de n'importe quelle PME qui ouvre
        // l'écran d'arbitrage. Même discipline que le select d'InvoicesService
        // .findOne sur user (passwordHash) : un champ ajouté plus tard à cette
        // table ne doit pas se retrouver exposé du seul fait qu'il existe.
        await this.prisma.financialPartner.findMany({
          where: { status: "active" },
          select: { id: true, name: true, type: true },
        })
      : [];
    return { financeable, partners, financedByPartner: invoice.financedByPartner ?? null };
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
      // Le refus est NOMMÉ quand la créance elle-même n'est plus cessible.
      // « Déjà encaissée » et « en litige » ne sont pas des conflits de
      // concurrence : ce sont des préconditions métier que rien ne rattrapera
      // en réessayant, d'où un 412 et non un 409. Les autres refus (pas encore
      // visée, déjà financée, compte acheteur non vérifié) restent des 409.
      const motif = motifCreanceNonCessible(invoice);
      if (motif) {
        throw new PreconditionFailedException({
          code: MOTIF_HTTP_CODE[motif],
          message: MOTIF_MESSAGE[motif](invoiceId),
        });
      }
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
        // La clause `where` dit QUE la revendication a échoué, jamais POURQUOI.
        // On relit dans la MÊME transaction — donc sous le même instantané que
        // la revendication, et sous le même GUC — pour distinguer le règlement
        // ou le litige survenu entre la lecture et le commit du cas ordinaire
        // « quelqu'un a financé avant nous ». Sans cette relecture, un
        // encaissement concurrent se présentait à la PME comme un doublon de
        // financement, et le partenaire n'avait aucun moyen de savoir que la
        // créance venait de s'éteindre.
        const apresCoup = await tx.invoice.findFirst({
          where: { id: invoiceId, organizationId },
          select: { status: true, disputeStatus: true },
        });
        const motif = apresCoup ? motifCreanceNonCessible(apresCoup) : null;
        if (motif) {
          throw new PreconditionFailedException({
            code: MOTIF_HTTP_CODE[motif],
            message: MOTIF_MESSAGE[motif](invoiceId),
          });
        }
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
