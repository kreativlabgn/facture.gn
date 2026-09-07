import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import type { CreditTransactionType, PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { TARIF_PAR_CANAL, type CanalFacturable } from "./credits.constants";

// RLS (ADR-111) — CARTE DU MODULE. `credit_transaction` porte organization_id
// en direct et a rejoint le registre (migration 20260907080000) : 30 tables au
// 2026-09-07. Toutes les méthodes sont SCOPÉES, sans exception — un relevé de
// compte est ce qu'une organisation a de plus privé après ses factures.
//
// LE REGISTRE EST LA VÉRITÉ, le solde n'en est que la somme. Les deux sont
// écrits dans la MÊME transaction : un mouvement sans mise à jour du solde, ou
// l'inverse, rendrait le portefeuille faux sans que rien ne le signale.
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async getBalance(organizationId: string): Promise<bigint> {
    const organization = await organizationScopedClient(this.prisma, organizationId).organization.findFirstOrThrow({
      where: { id: organizationId },
      select: { creditBalanceCentimes: true },
    });
    return organization.creditBalanceCentimes;
  }

  /** Relevé de compte, antéchronologique : ce qui vient de se passer est ce
   *  qu'on cherche. */
  async getStatement(organizationId: string, take = 50) {
    return organizationScopedClient(this.prisma, organizationId).creditTransaction.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: Math.min(take, 200),
    });
  }

  /** Un envoi est-il finançable ? Lecture seule — la décision de bloquer
   *  appartient à l'appelant, qui sait si l'action est essentielle. */
  async peutFinancer(organizationId: string, canal: CanalFacturable): Promise<boolean> {
    return (await this.getBalance(organizationId)) >= TARIF_PAR_CANAL[canal];
  }

  /** Crédite le portefeuille. Réservé à la console d'administration : aucun
   *  encaissement automatique n'existe, c'est facture.gn qui décide. */
  async grant(
    organizationId: string,
    amountCentimes: bigint,
    label: string,
    options: { type?: CreditTransactionType; actorId?: string } = {},
  ) {
    if (amountCentimes <= 0n) {
      throw new ConflictException("Un rechargement doit être strictement positif");
    }
    return this.mouvement(organizationId, amountCentimes, label, {
      type: options.type ?? "purchase",
      actorId: options.actorId,
    });
  }

  /** Débite le portefeuille pour un envoi. Rend null — et n'écrit RIEN — quand
   *  le solde est insuffisant : c'est à l'appelant de décider quoi en faire,
   *  parce que lui seul sait si l'envoi peut être annulé. */
  async consume(
    organizationId: string,
    canal: CanalFacturable,
    label: string,
    invoiceId?: string,
  ): Promise<{ balanceAfterCentimes: bigint } | null> {
    const cout = TARIF_PAR_CANAL[canal];
    try {
      return await this.mouvement(organizationId, -cout, label, { type: "consumption", invoiceId });
    } catch (error) {
      if (error instanceof ConflictException) {
        return null;
      }
      throw error;
    }
  }

  /** Remise en crédit d'un envoi facturé mais non parti. */
  async refund(organizationId: string, canal: CanalFacturable, label: string, invoiceId?: string) {
    return this.mouvement(organizationId, TARIF_PAR_CANAL[canal], label, {
      type: "refund",
      invoiceId,
    });
  }

  /** Recalcule le solde depuis le registre. Le registre étant la vérité, cette
   *  méthode ne peut que corriger la dénormalisation — jamais l'inverse. */
  async reconcile(organizationId: string): Promise<{ avant: bigint; apres: bigint }> {
    return this.prisma.$transaction(async (tx) => {
      await setOrganizationScope(tx, organizationId);

      const organization = await tx.organization.findFirstOrThrow({
        where: { id: organizationId },
        select: { creditBalanceCentimes: true },
      });
      const somme = await tx.creditTransaction.aggregate({
        where: { organizationId },
        _sum: { amountCentimes: true },
      });
      const apres = somme._sum.amountCentimes ?? 0n;

      if (apres !== organization.creditBalanceCentimes) {
        await tx.organization.update({
          where: { id: organizationId },
          data: { creditBalanceCentimes: apres },
        });
        this.logger.warn(
          `Solde de crédits corrigé pour ${organizationId} : ${organization.creditBalanceCentimes} → ${apres}`,
        );
      }

      return { avant: organization.creditBalanceCentimes, apres };
    });
  }

  // Le cœur : registre et solde écrits ENSEMBLE, jamais l'un sans l'autre.
  //
  // La transaction interactive sérialise les mouvements concurrents d'une même
  // organisation : deux relances simultanées ne peuvent pas lire le même solde
  // et le débiter deux fois à partir de la même base. Le contrôle de suffisance
  // vit DANS la transaction, pas avant.
  private async mouvement(
    organizationId: string,
    amountCentimes: bigint,
    label: string,
    options: { type: CreditTransactionType; actorId?: string; invoiceId?: string },
  ): Promise<{ balanceAfterCentimes: bigint }> {
    return this.prisma.$transaction(async (tx) => {
      await setOrganizationScope(tx, organizationId);

      const organization = await tx.organization.findFirstOrThrow({
        where: { id: organizationId },
        select: { creditBalanceCentimes: true },
      });

      const balanceAfterCentimes = organization.creditBalanceCentimes + amountCentimes;
      // Un portefeuille ne descend jamais sous zéro : un solde négatif serait
      // une dette que rien dans ce système ne sait recouvrer.
      if (balanceAfterCentimes < 0n) {
        throw new ConflictException("Solde de crédits insuffisant");
      }

      await tx.creditTransaction.create({
        data: {
          organizationId,
          type: options.type,
          amountCentimes,
          balanceAfterCentimes,
          label,
          invoiceId: options.invoiceId ?? null,
          actorId: options.actorId ?? null,
        },
      });

      await tx.organization.update({
        where: { id: organizationId },
        data: { creditBalanceCentimes: balanceAfterCentimes },
      });

      return { balanceAfterCentimes };
    });
  }
}
