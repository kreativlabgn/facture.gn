import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import type { CreateOrganizationDto } from "./dto/create-organization.dto";

@Injectable()
export class OrganizationsService {
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

    return this.prisma.organization.update({
      where: { id: organizationId },
      data: { dgiVerificationStatus: "verified" },
    });
  }
}
