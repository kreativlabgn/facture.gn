import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { practiceScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { REVENUE_SHARE_CAP_PER_CLIENT_CENTIMES_GNF, REVENUE_SHARE_RATE_BPS } from "./revenue-share-grid";
import { getPartnerTierPrice } from "../practices/partner-tier-grid";
import { mandateNotExpiredWhere } from "../common/rbac/mandate-expiration";
import { assertPracticeAdmin } from "../common/rbac/practice-access";

const BPS_DENOMINATOR = 10_000n;

// RLS (ADR-111 étape 1) — CARTE DU MODULE. Ce module est ENTIÈREMENT scopé
// CABINET, jamais organisation : `mandate` et `revenue_share_credit` portent
// `practice_id` en direct, et c'est `practiceScopedClient` qui s'applique
// partout. Un setOrganizationScope() serait ici une erreur de nature.
//
// Le cas le plus intéressant du chantier est la lecture des paiements de
// generate() : `payment` est sous RLS par indirection (via invoice_id), et sous
// `app.current_practice_id` sa politique délègue à `rls_practice_sees_org()`,
// qui rend vrai exactement pour les organisations à mandat actif non expiré du
// cabinet. Le scope cabinet et le `where` applicatif
// (`organizationId: { in: organizationIds }`, tiré des mêmes mandats actifs)
// désignent donc le MÊME ensemble, par construction — c'est la « vue
// transversale cabinet » pour laquelle la politique combinée a été écrite
// (DAT §7.2). Aucune requête ne pose les deux GUC.
//
// Restent GLOBAUX : `practice_member` (via les gardes d'appartenance et
// assertPracticeAdmin) et `professional_practice` — tous deux HORS RLS
// (annuaire cabinet partagé, vérifié : aucune ENABLE ROW LEVEL SECURITY).
//
// Aucune transaction dans ce module : generate() est une boucle d'upserts
// idempotents (@@unique practiceId+organizationId+periodMonth), pas un bloc
// atomique. Aucun setPracticeScope() n'a donc lieu d'être posé.
@Injectable()
export class RevenueShareService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // H4, ADR-071 — restreint à practice_admin (action qui crée un enregistrement
  // financier), même restriction déjà appliquée à inviteMember() (F8).
  // Génération manuelle : aucun cron dans ce repo (voir PLAN "Clarifications"),
  // l'appelant choisit explicitement la période à clôturer.
  async generate(practiceId: string, requesterUserId: string, periodMonth: string) {
    // practice_member est hors RLS : cette garde reste sur le client global.
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId, "générer le revenue share");

    const scoped = practiceScopedClient(this.prisma, practiceId);
    const { start, end } = resolvePeriodBounds(periodMonth);

    const activeMandates = await scoped.mandate.findMany({
      where: { practiceId, status: "active", ...mandateNotExpiredWhere() },
    });

    // Quality Audit 2026-08-23, finding #13 — UNE seule requête pour la somme
    // des commissions de TOUTES les organisations mandantes de la période,
    // plutôt qu'un payment.aggregate() répété par mandat dans la boucle (3
    // round-trips DB séquentiels par mandat auparavant : findUnique + aggregate
    // + upsert). Payment n'a pas de organizationId scalaire propre (seulement
    // invoiceId) — un vrai groupBy Prisma sur invoice.organizationId n'est donc
    // pas possible nativement ; on récupère les paiements pertinents en une
    // fois et on agrège en JS, plutôt que du $queryRaw (pas nécessaire ici,
    // contrairement au verrou FOR UPDATE du finding #1 — le volume de lignes
    // reste borné à une période/un portefeuille de mandats, pas à tout
    // l'historique).
    const organizationIds = activeMandates.map((mandate) => mandate.organizationId);
    // Vue transversale cabinet — voir la carte en tête de classe : sous scope
    // cabinet, la politique de `payment` retient exactement les organisations
    // mandatées, le même ensemble que `organizationIds` ci-dessus.
    const relevantPayments = await scoped.payment.findMany({
      where: {
        invoice: { organizationId: { in: organizationIds } },
        status: "completed",
        collectedAt: { gte: start, lt: end },
      },
      select: { platformFeeAmount: true, invoice: { select: { organizationId: true } } },
    });
    const commissionByOrganization = new Map<string, bigint>();
    for (const payment of relevantPayments) {
      const organizationId = payment.invoice.organizationId;
      commissionByOrganization.set(
        organizationId,
        (commissionByOrganization.get(organizationId) ?? 0n) + payment.platformFeeAmount,
      );
    }

    const credits = [];
    for (const mandate of activeMandates) {
      // Un crédit déjà marqué "paid" (futur mécanisme, pas encore construit)
      // n'est jamais recalculé/écrasé — un paiement tardif ne doit jamais
      // changer silencieusement un montant déjà versé. Trouvé en revue
      // dev-code-reviewer (agent 1, idempotence).
      const existingCredit = await scoped.revenueShareCredit.findFirst({
        where: { practiceId, organizationId: mandate.organizationId, periodMonth },
      });
      if (existingCredit && existingCredit.status === "paid") {
        credits.push(existingCredit);
        continue;
      }

      const grossCommissionCentimes = commissionByOrganization.get(mandate.organizationId) ?? 0n;
      const rawShare = (grossCommissionCentimes * BigInt(REVENUE_SHARE_RATE_BPS)) / BPS_DENOMINATOR;
      const creditedAmountCentimes =
        rawShare > REVENUE_SHARE_CAP_PER_CLIENT_CENTIMES_GNF ? REVENUE_SHARE_CAP_PER_CLIENT_CENTIMES_GNF : rawShare;

      // Upsert — idempotent : régénérer la même période met à jour, jamais un
      // doublon (@@unique practiceId+organizationId+periodMonth).
      // L'upsert garde sa clé composée : un `where` d'upsert doit être unique et
      // ne peut donc pas être remplacé par un findFirst. Elle porte déjà
      // practiceId — la colonne de scope y est bien présente.
      const credit = await scoped.revenueShareCredit.upsert({
        where: {
          practiceId_organizationId_periodMonth: {
            practiceId,
            organizationId: mandate.organizationId,
            periodMonth,
          },
        },
        create: {
          practiceId,
          organizationId: mandate.organizationId,
          periodMonth,
          grossCommissionCentimes,
          creditedAmountCentimes,
        },
        update: { grossCommissionCentimes, creditedAmountCentimes },
      });
      credits.push(credit);
    }

    return credits;
  }

  // Tout membre actif suffit (même discipline que PracticesService.listMembers()
  // — F8 : consultation, pas une action administrative).
  async listByPractice(practiceId: string, requesterUserId: string) {
    const membership = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId: requesterUserId, leftAt: null },
    });
    if (!membership) {
      throw new ForbiddenException("Seul un membre du cabinet peut consulter son revenue share");
    }

    return practiceScopedClient(this.prisma, practiceId).revenueShareCredit.findMany({
      where: { practiceId },
    });
  }

  // H3, ADR-071, Grille-Offres §5.2 — vue calculée à la demande, jamais
  // d'entité persistée pour la "facture" d'abonnement (décision utilisateur,
  // voir PLAN "Alternatives écartées"). Tout membre actif suffit (consultation,
  // même discipline que listByPractice()). N'affecte JAMAIS un
  // RevenueShareCredit existant — lecture seule, oriente uniquement le calcul.
  async getPartnerSubscriptionStatus(practiceId: string, requesterUserId: string, periodMonth: string) {
    const membership = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId: requesterUserId, leftAt: null },
    });
    if (!membership) {
      throw new ForbiddenException("Seul un membre du cabinet peut consulter son abonnement Partner");
    }

    // professional_practice est HORS RLS : lecture globale à dessein. Pas
    // d'oracle malgré le *OrThrow — la garde d'appartenance ci-dessus lève déjà
    // ForbiddenException pour un practiceId inconnu (aucune appartenance ne peut
    // exister sur un cabinet qui n'existe pas), cette ligne n'est jamais
    // atteinte avec un identifiant inconnu.
    const practice = await this.prisma.professionalPractice.findUniqueOrThrow({ where: { id: practiceId } });
    const price = getPartnerTierPrice(practice.tier);

    if (price.kind === "quote_required") {
      return { practiceId, periodMonth, tier: practice.tier, amountDueCentimes: null as bigint | null };
    }

    if (practice.revenueShareSettlementMode === "payout") {
      return { practiceId, periodMonth, tier: practice.tier, amountDueCentimes: price.amountCentimes };
    }

    const aggregate = await practiceScopedClient(this.prisma, practiceId).revenueShareCredit.aggregate({
      where: { practiceId, periodMonth },
      _sum: { creditedAmountCentimes: true },
    });
    const totalCreditedCentimes = aggregate._sum.creditedAmountCentimes ?? 0n;
    const remaining = price.amountCentimes - totalCreditedCentimes;
    const amountDueCentimes = remaining > 0n ? remaining : 0n;

    return { practiceId, periodMonth, tier: practice.tier, amountDueCentimes };
  }
}

// periodMonth au format "YYYY-MM" — bornes UTC [start, end).
function resolvePeriodBounds(periodMonth: string): { start: Date; end: Date } {
  const [year, month] = periodMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}
