import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { CreditsService } from "../credits/credits.service";
import {
  MAX_TENTATIVES_CODE,
  PALIER_NON_CONVERTI,
  PRIME_FILLEUL_CENTIMES,
  PRIME_PARRAIN_CENTIMES,
  genererCodeParrainage,
} from "./referrals.constants";

// RLS (ADR-111) — CARTE DU MODULE. `referral` a rejoint le registre (migration
// 20260907090000) : 31 tables au 2026-09-07. Sa politique porte sur
// referrer_organization_id — chaque parrain voit ses filleuls, personne d'autre.
//
// DEUX LECTURES SONT NON SCOPÉES, et chacune pour une raison précise :
//
//   • resoudreCode() — trouver le parrain PAR SON CODE est une découverte : le
//     filleul ne connaît pas encore l'organisation du parrain, et sous son
//     propre scope il ne verrait rien. Même famille que le contrôle de NIF
//     global et que la lecture d'organisation de MandatesService.create().
//
//   • convertir() — au moment de la conversion, on lit la ligne de parrainage
//     depuis l'organisation du FILLEUL, alors que la politique la rattache au
//     PARRAIN. C'est le même œuf-et-poule que les mandats : sous scope filleul,
//     la ligne est invisible.
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly credits: CreditsService,
  ) {}

  /** Active le programme et rend le code. Idempotent : réactiver rend le code
   *  déjà attribué plutôt que d'en générer un second, qui invaliderait les
   *  partages déjà faits. */
  async activate(organizationId: string): Promise<{ referralCode: string }> {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const organization = await scoped.organization.findFirstOrThrow({
      where: { id: organizationId },
      select: { referralCode: true },
    });
    if (organization.referralCode) {
      return { referralCode: organization.referralCode };
    }

    // Retry sur collision, même précédent que le code-compte (ADR-047) : le
    // tirage est aléatoire, la collision rare mais possible, et un 500 brut
    // serait injustifiable.
    for (let tentative = 1; tentative <= MAX_TENTATIVES_CODE; tentative++) {
      const referralCode = genererCodeParrainage();
      try {
        await scoped.organization.update({ where: { id: organizationId }, data: { referralCode } });
        return { referralCode };
      } catch (error) {
        if (isUniqueConstraintViolation(error, "referral_code") && tentative < MAX_TENTATIVES_CODE) {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException("Impossible de générer un code de parrainage unique");
  }

  /** Rattache un filleul à un parrain, à l'inscription. Ne verse RIEN : la
   *  prime attend le premier abonnement payant. */
  async attach(referredOrganizationId: string, code: string): Promise<void> {
    const parrain = await this.resoudreCode(code);
    if (!parrain) {
      throw new NotFoundException("Code de parrainage inconnu");
    }
    if (parrain.id === referredOrganizationId) {
      // Se parrainer soi-même doublerait la prime sans amener personne.
      throw new ConflictException("Une organisation ne peut pas se parrainer elle-même");
    }

    // Le nom est recopié : sous RLS, le parrain ne pourra jamais lire
    // l'organisation du filleul pour l'afficher.
    const filleul = await this.prisma.organization.findUnique({
      where: { id: referredOrganizationId },
      select: { name: true },
    });
    if (!filleul) {
      throw new NotFoundException(`Organisation ${referredOrganizationId} introuvable`);
    }

    try {
      // Écriture sous le scope du PARRAIN : c'est lui que la politique
      // reconnaît sur referrer_organization_id, et donc lui qui satisfait le
      // WITH CHECK.
      await this.prisma.$transaction(async (tx) => {
        await setOrganizationScope(tx, parrain.id);
        await tx.referral.create({
          data: {
            referrerOrganizationId: parrain.id,
            referredOrganizationId,
            referredName: filleul.name,
            code,
          },
        });
      });
    } catch (error) {
      // referred_organization_id est @unique : un marchand n'est parrainé
      // qu'une fois, et c'est la base qui l'empêche, pas seulement ce code.
      if (isUniqueConstraintViolation(error, "referred_organization_id")) {
        throw new ConflictException("Cette organisation est déjà rattachée à un parrain");
      }
      throw error;
    }
  }

  /** Verse les deux primes quand le filleul passe à un palier payant.
   *
   *  Appelée à chaque changement de palier — d'où l'idempotence par le statut :
   *  un marchand qui monte de Starter à Pro ne redéclenche rien. Ne lève jamais :
   *  une prime qui échoue ne doit pas faire échouer le changement de palier,
   *  qui est l'action que l'utilisateur a demandée. */
  async convertirSiEligible(referredOrganizationId: string, nouveauPalier: string): Promise<void> {
    if (nouveauPalier === PALIER_NON_CONVERTI) {
      return;
    }

    try {
      // Lecture NON SCOPÉE : la politique rattache la ligne au parrain, or on
      // arrive ici depuis le filleul. Sous son scope, elle est invisible.
      const referral = await this.prisma.referral.findUnique({
        where: { referredOrganizationId },
      });
      if (!referral || referral.status === "converted") {
        return;
      }

      await this.credits.grant(
        referral.referrerOrganizationId,
        PRIME_PARRAIN_CENTIMES,
        `Prime de parrainage — ${referral.referredName}`,
        { type: "adjustment" },
      );
      await this.credits.grant(
        referredOrganizationId,
        PRIME_FILLEUL_CENTIMES,
        "Prime de bienvenue — parrainage",
        { type: "adjustment" },
      );

      await this.prisma.$transaction(async (tx) => {
        await setOrganizationScope(tx, referral.referrerOrganizationId);
        await tx.referral.update({
          where: { id: referral.id },
          data: {
            status: "converted",
            convertedAt: new Date(),
            referrerBonusCentimes: PRIME_PARRAIN_CENTIMES,
            referredBonusCentimes: PRIME_FILLEUL_CENTIMES,
          },
        });
      });

      this.logger.log(
        `Parrainage converti : ${referral.referrerOrganizationId} → ${referredOrganizationId}`,
      );
    } catch (error) {
      // Le changement de palier reste acquis : la prime est un bonus, pas une
      // condition. L'échec est tracé pour rattrapage, jamais silencieux.
      this.logger.error(
        `Échec du versement des primes de parrainage pour ${referredOrganizationId}`,
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
  }

  /** Le tableau de bord du parrain. */
  async summary(organizationId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const [organization, referrals] = await Promise.all([
      scoped.organization.findFirstOrThrow({
        where: { id: organizationId },
        select: { referralCode: true },
      }),
      scoped.referral.findMany({
        where: { referrerOrganizationId: organizationId },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);

    const totalGainsCentimes = referrals
      .reduce((somme, referral) => somme + (referral.referrerBonusCentimes ?? 0n), 0n)
      .toString();

    return {
      isActive: organization.referralCode !== null,
      referralCode: organization.referralCode,
      totalGainsCentimes,
      referrals,
    };
  }

  // Découverte : on cherche le parrain PAR SON CODE, sans savoir qui il est.
  // Aucun scope ne peut voir une organisation qu'on n'a pas encore identifiée.
  // Ne rend que l'id — jamais le nom, que le filleul n'a pas à connaître pour
  // saisir un code.
  private async resoudreCode(code: string): Promise<{ id: string } | null> {
    return this.prisma.organization.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
  }
}
