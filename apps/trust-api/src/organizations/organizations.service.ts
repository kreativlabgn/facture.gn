import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { CreateOrganizationDto } from "./dto/create-organization.dto";

function isUniqueConstraintViolation(error: unknown, field: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002" &&
    Array.isArray((error as { meta?: { target?: unknown } }).meta?.target) &&
    ((error as { meta: { target: string[] } }).meta.target.includes(field))
  );
}

@Injectable()
export class OrganizationsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async create(dto: CreateOrganizationDto) {
    try {
      return await this.prisma.organization.create({
        data: {
          name: dto.name,
          regimeFiscal: dto.regimeFiscal,
          legalForm: dto.legalForm,
          nif: dto.nif,
          etaxNumber: dto.etaxNumber,
          rccm: dto.rccm,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error, "nif")) {
        throw new ConflictException(`Une organisation avec le NIF ${dto.nif} existe déjà`);
      }
      throw error;
    }
  }
}
