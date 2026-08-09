import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { CreatePracticeDto } from "./dto/create-practice.dto";
import type { InviteMemberDto } from "./dto/invite-member.dto";

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

  // F8, ADR-068 — "collaborateurs" fait partie de la définition même de
  // professional_practice. F10 (hors scope ici) couvre l'invitation d'un
  // utilisateur SANS compte facture.gn — ici l'invité est déjà inscrit,
  // identifié par UserPhone (même mécanisme de résolution que
  // OrganizationsService.createAssisted()). Ajout immédiat, aucun flux
  // d'acceptation (contrairement au mandat, F1/F5, ADR-069) — pas de support
  // pour ça dans ce backlog.
  async inviteMember(practiceId: string, dto: InviteMemberDto, requesterUserId: string) {
    const requesterMembership = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId: requesterUserId, leftAt: null },
    });
    if (!requesterMembership || requesterMembership.role !== "practice_admin") {
      throw new ForbiddenException(
        "Seul un practice_admin du cabinet peut inviter un collaborateur au nom de celui-ci",
      );
    }

    const userPhone = await this.prisma.userPhone.findUnique({ where: { msisdn: dto.msisdn } });
    if (!userPhone) {
      throw new NotFoundException(`Compte introuvable pour le numéro ${dto.msisdn}`);
    }

    const existingMembership = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId: userPhone.userId, leftAt: null },
    });
    if (existingMembership) {
      throw new ConflictException(`Cet utilisateur est déjà membre de la practice ${practiceId}`);
    }

    return this.prisma.practiceMember.create({
      data: { practiceId, userId: userPhone.userId, role: dto.role },
    });
  }
}
