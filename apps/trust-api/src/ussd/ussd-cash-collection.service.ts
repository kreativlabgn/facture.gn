import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { InvoiceStatus, OrganizationRole, PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { OrganizationsService } from "../organizations/organizations.service";
import { PaymentsService } from "../payments/payments.service";
import { CASH_PROOF_THRESHOLD_GNF_CENTIMES } from "../payments/dto/create-payment.dto";

const PAYABLE_STATUSES: InvoiceStatus[] = ["issued", "partially_paid"];

// Même trio de style qu'EMIT_ELIGIBLE_ROLES (ussd-invoice.service.ts) —
// valeurs différentes, décision produit dédiée à l'encaissement cash.
const CASH_COLLECTION_ELIGIBLE_ROLES: OrganizationRole[] = ["owner", "admin", "cashier"];

// *620#, capacité 3 (encaissement cash) — depuis l'historique (option 3) ou la
// recherche composite (capacité 2), jamais l'apurement Z de caisse ADR-119
// (invoices.service.ts:456-564), strictement hors sujet ici. Délègue
// entièrement le règlement à PaymentsService.recordCashPayment(), jamais une
// seconde implémentation de l'idempotence/paiement partiel/transitions de
// statut.
@Injectable()
export class UssdCashCollectionService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly organizationsService: OrganizationsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  // Aperçu affiché AVANT confirmation (écran "cash_collect_confirm") — lecture
  // scopée, statut payable uniquement. Réutilisé par presentCashCollectConfirmation
  // (ussd-session.service.ts), appelé aussi bien depuis l'historique que depuis
  // la recherche (capacité 2), jamais deux implémentations de cet aperçu.
  async previewCollectible(organizationId: string, invoiceId: string) {
    const invoice = await organizationScopedClient(this.prisma, organizationId).invoice.findFirst({
      where: { id: invoiceId, organizationId, status: { in: PAYABLE_STATUSES } },
    });
    if (!invoice) {
      return null;
    }
    return { id: invoice.id, number: invoice.number, amountDue: invoice.amountDue };
  }

  // sessionId : le sessionId OPÉRATEUR (session.sessionId), jamais l'id UUID
  // Prisma de la ligne UssdSession — voir Décision d'architecture #5 du plan
  // (idempotencyKey déterministe pour la durée de vie d'UNE session USSD).
  async collect(sessionId: string, invoiceId: string, organizationId: string, actorId: string) {
    await this.assertEligibleRole(actorId, organizationId);

    // Revérifie TOUJOURS l'état de la facture à chaud avant d'agir, jamais une
    // lecture antérieure (même discipline que regeneratePaymentLink()) — un
    // autre règlement concurrent a pu changer amountDue/status entre l'aperçu
    // et cette confirmation.
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const invoice = await scoped.invoice.findFirst({ where: { id: invoiceId, organizationId } });
    if (!invoice) {
      throw new NotFoundException(`Facture ${invoiceId} introuvable`);
    }
    if (!PAYABLE_STATUSES.includes(invoice.status)) {
      throw new ConflictException(`Facture ${invoiceId} ne peut recevoir de paiement depuis le statut ${invoice.status}`);
    }

    // Pré-vérification LÉGÈRE côté USSD (même calcul que
    // PaymentsService.assertCashProofRequirement(), volontairement dupliqué
    // pour produire un message clair avec le montant exact AVANT d'appeler
    // recordCashPayment() — la garde AUTHENTIFIÉE réelle reste entièrement
    // dans PaymentsService.assertCashProofRequirement(), jamais recalculée ici
    // comme seule barrière. Voir plan, Alternatives écartées + Risque 2 :
    // toute dérive future du calcul du seuil dans un seul des deux endroits
    // romprait la cohérence du MESSAGE affiché, jamais la garde réelle.
    const organization = await scoped.organization.findFirstOrThrow({ where: { id: organizationId } });
    const effectiveThreshold = organization.commissionBypassProofThresholdOverrideGnf ?? CASH_PROOF_THRESHOLD_GNF_CENTIMES;
    if (invoice.amountDue > effectiveThreshold) {
      throw new BadRequestException(
        `Au-delà de ${formatGnfPlainText(effectiveThreshold.toString())}, encaissez depuis l'application avec preuve.`,
      );
    }

    // Aucun montant mémorisé depuis l'étape de sélection — amountDue relu à
    // chaud juste au-dessus, jamais une valeur stashée dans le contexte de
    // session (décision d'architecture #6 du plan).
    const idempotencyKey = `ussd-cash:${sessionId}`;
    const payment = await this.paymentsService.recordCashPayment(
      invoiceId,
      organizationId,
      { amount: invoice.amountDue, method: "cash" },
      idempotencyKey,
      "ussd",
    );

    return {
      message: `Facture ${invoice.number} encaissée en cash (${formatGnfPlainText(invoice.amountDue.toString())}). Paiement ${payment.id}.`,
    };
  }

  // RBAC reconstruite en ligne (CONTRIBUTING.md §RBAC) : ce canal est
  // @Public(), RolesGuard/@Roles() ne tournent jamais ici.
  private async assertEligibleRole(actorId: string, organizationId: string): Promise<void> {
    const memberships = await this.organizationsService.listMine(actorId);
    const membership = memberships.find((membership: { id: string; role: OrganizationRole }) => membership.id === organizationId);
    if (!membership || !CASH_COLLECTION_ELIGIBLE_ROLES.includes(membership.role)) {
      throw new ForbiddenException("Rôle non habilité à encaisser un paiement cash pour cette organisation.");
    }
  }
}

// Pas d'Intl.NumberFormat (pas de garantie de locale complète en environnement
// Node minimal) — même convention que formatGnfPlainText (ussd-session.service.ts),
// dupliquée localement ici plutôt que partagée : ce fichier ne dépend pas du
// gros fichier de session pour une fonction de 5 lignes.
function formatGnfPlainText(centimesString: string): string {
  const centimes = BigInt(centimesString);
  const gnf = centimes / 100n;
  const withThousands = gnf.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${withThousands} GNF`;
}
