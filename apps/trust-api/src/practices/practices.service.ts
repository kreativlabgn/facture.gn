import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { CreatePracticeDto } from "./dto/create-practice.dto";

@Injectable()
export class PracticesService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // Le créateur devient practice_admin dans la même transaction — même précédent
  // qu'OrganizationsService.create() (owner) : jamais une practice sans au moins un
  // membre pouvant en gérer les accès.
  async create(dto: CreatePracticeDto, creatorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const practice = await tx.professionalPractice.create({
        data: {
          type: dto.type,
          name: dto.name,
          registrationNumber: dto.registrationNumber,
          phone: dto.phone,
          email: dto.email,
        },
      });

      await tx.practiceMember.create({
        data: { practiceId: practice.id, userId: creatorUserId, role: "practice_admin" },
      });

      return practice;
    });
  }
}
