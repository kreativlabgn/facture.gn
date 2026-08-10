import { ConflictException, ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { generateAccountCode } from "./account-code";
import type { CreateOrganizationDto } from "./dto/create-organization.dto";
import type { CreateAssistedOrganizationDto } from "./dto/create-assisted-organization.dto";
import type { CreateFromApipDto } from "./dto/create-from-apip.dto";

const MAX_ACCOUNT_CODE_ATTEMPTS = 3;

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // Le créateur devient owner dans la même transaction — aucune organisation ne
  // doit exister sans au moins un membre pouvant en gérer les accès.
  async create(dto: CreateOrganizationDto, creatorUserId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: dto.name,
            regimeFiscal: dto.regimeFiscal,
            legalForm: dto.legalForm,
            nif: dto.nif,
            etaxNumber: dto.etaxNumber,
            rccm: dto.rccm,
          },
        });
        await tx.organizationMember.create({
          data: { organizationId: organization.id, userId: creatorUserId, role: "owner" },
        });
        return organization;
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error, "nif")) {
        throw new ConflictException(`Une organisation avec le NIF ${dto.nif} existe déjà`);
      }
      throw error;
    }
  }

  // "En tant que système" (B2, backlog) — aucun rôle organisationnel ne peut
  // déclencher ceci (voir DgiVerificationAuthGuard) : une organisation ne peut pas
  // s'auto-certifier vérifiée DGI, ça viderait la vérification de son sens.
  async verifyDgi(organizationId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    if (!organization.nif || !organization.etaxNumber) {
      throw new ConflictException(
        "Impossible de vérifier une organisation sans NIF ni eTax — les deux sont exigés conjointement (ADR-035)",
      );
    }

    if (organization.dgiVerificationStatus === "verified") {
      return organization;
    }

    const verified = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { dgiVerificationStatus: "verified" },
    });

    // Traçabilité (revue sécurité B2) : seule trace de qui/quand une organisation a
    // été élevée à verified — jamais de NIF/eTax ici, uniquement l'id, déjà non
    // sensible seul (UUID opaque).
    this.logger.log(`Organisation ${organizationId} vérifiée DGI (dgi_verification_status → verified)`);

    return verified;
  }

  // ADR-045/046/047, B5 — Chemin B : un agent terrain saisit l'inscription à la
  // place du marchand. isFieldAgent est rechargé depuis la DB (jamais fait confiance
  // au JWT/params) : c'est la seule frontière d'autorisation ici, RolesGuard ne
  // couvre pas ce statut plateforme. Le marchand créé (passwordHash: null, comme
  // tout placeholder Chemin B) devient owner — jamais l'agent lui-même, qui n'obtient
  // aucune OrganizationMember : AssistedSession est la seule preuve du lien
  // agent↔organisation (voir schema.prisma).
  async createAssisted(fieldAgentUserId: string, dto: CreateAssistedOrganizationDto) {
    const agent = await this.prisma.user.findUniqueOrThrow({ where: { id: fieldAgentUserId } });
    if (!agent.isFieldAgent) {
      throw new ForbiddenException("Seul un agent terrain peut créer une organisation en inscription assistée");
    }

    if (dto.msisdn) {
      const existingPhone = await this.prisma.userPhone.findUnique({ where: { msisdn: dto.msisdn } });
      if (existingPhone) {
        throw new ConflictException(`Un compte existe déjà pour le numéro ${dto.msisdn}`);
      }
    }

    // Retry sur collision de code-compte (ADR-047, même précédent que
    // certification_id — B1/B4) : 8 caractères Base32 tirés aléatoirement, la
    // collision est rare mais possible, jamais un 500 brut pour l'agent terrain.
    for (let attempt = 1; attempt <= MAX_ACCOUNT_CODE_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const organization = await tx.organization.create({
            data: {
              name: dto.organizationName,
              regimeFiscal: dto.regimeFiscal,
              legalForm: dto.legalForm,
              nif: dto.nif,
              etaxNumber: dto.etaxNumber,
              accountCode: generateAccountCode(),
            },
          });

          const merchant = await tx.user.create({ data: { name: dto.merchantName, passwordHash: null } });

          if (dto.msisdn) {
            await tx.userPhone.create({ data: { userId: merchant.id, msisdn: dto.msisdn, isPrimary: true } });
          }

          await tx.organizationMember.create({
            data: { organizationId: organization.id, userId: merchant.id, role: "owner" },
          });

          await tx.assistedSession.create({
            data: { fieldAgentUserId, organizationId: organization.id, consentRecordedAt: new Date() },
          });

          return organization;
        });
      } catch (error) {
        const isLastAttempt = attempt === MAX_ACCOUNT_CODE_ATTEMPTS;
        if (isUniqueConstraintViolation(error, "account_code") && !isLastAttempt) {
          continue;
        }
        throw error;
      }
    }

    // Inatteignable : la boucle retourne ou lève à chaque itération.
    throw new ConflictException("Impossible de générer un code-compte unique après plusieurs tentatives");
  }

  // E8, ADR-093 — "aucune valeur contractuelle", strictement informatif, dérivé de
  // payment.method sur des données déjà captées. Arrhes (depositType="arrhes")
  // toujours exclues des deux totaux : bucket financier distinct (C5), jamais un
  // "encaissement" de facture au sens de cet indicateur. ratio:null (jamais un faux
  // 0%) pour une organisation sans historique — 0% laisserait croire à un mauvais
  // historique plutôt qu'à une absence de données.
  async getVerifiedPaymentRatio(organizationId: string) {
    const [total, verified] = await Promise.all([
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { invoice: { organizationId }, depositType: null },
      }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { invoice: { organizationId }, depositType: null, method: "payment_link" },
      }),
    ]);

    const totalAmount = total._sum.amount ?? 0n;
    const verifiedAmount = verified._sum.amount ?? 0n;
    const ratio = totalAmount > 0n ? Number(verifiedAmount) / Number(totalAmount) : null;

    return { totalAmount, verifiedAmount, ratio };
  }

  // F11, ADR-077 — auto-création depuis un webhook APIP signé (voir
  // PartnerWebhookAuthGuard). AUCUN OrganizationMember créé : personne ne s'est
  // encore inscrite pour revendiquer cette organisation (mécanisme de
  // réclamation hors scope, non scaffoldé) — contrairement à create()/
  // createAssisted(), qui créent toujours un owner dans la même transaction.
  // commercialTier/dgiVerificationStatus déjà "freemium"/"unverified" par
  // défaut du schema, jamais redondants ici.
  //
  // Idempotence : Organization.nif est déjà @unique — une redélivraison webhook
  // (même NIF, ADR-016) percute nativement cette contrainte. Plutôt qu'un
  // stockage de clés d'idempotence dédié, on capture la collision et on
  // retourne l'organisation existante — sémantique idempotente correcte (même
  // entrée → même résultat, jamais une erreur), sans nouvelle infrastructure.
  async createFromApip(dto: CreateFromApipDto) {
    try {
      return await this.prisma.organization.create({
        data: {
          name: dto.name,
          regimeFiscal: dto.regimeFiscal,
          legalForm: dto.legalForm,
          nif: dto.nif,
          rccm: dto.rccm,
          registrationSource: "apip",
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error, "nif")) {
        return this.prisma.organization.findUniqueOrThrow({ where: { nif: dto.nif } });
      }
      throw error;
    }
  }
}
