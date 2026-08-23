import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  PrismaClient,
  ProfessionalPracticeTier,
  ProfessionalPracticeType,
  RevenueShareSettlementMode,
} from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { assertPracticeAdmin } from "../common/rbac/practice-access";
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

  // Écran "Collaborateurs" du dashboard cabinet — même garde que
  // listAccessibleOrganizations (F7) : tout membre actif suffit, pas seulement
  // practice_admin (consultation, pas une action administrative).
  async listMembers(practiceId: string, requesterUserId: string) {
    const requesterMembership = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId: requesterUserId, leftAt: null },
    });
    if (!requesterMembership) {
      throw new ForbiddenException("Seul un membre du cabinet peut consulter ses collaborateurs");
    }

    return this.prisma.practiceMember.findMany({
      where: { practiceId, leftAt: null },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  // F12, ADR-078 — "liste des CGA actifs" : ProfessionalPractice n'a aucun
  // concept "actif/inactif" scaffoldé, toute practice existante du type demandé
  // est retournée. Scope à "cga" uniquement pour cette story (jamais généralisé).
  async findAllByType(type: ProfessionalPracticeType) {
    return this.prisma.professionalPractice.findMany({ where: { type } });
  }

  // Distinct de findAllByType("cga") ci-dessus (liste TOUTES les CGA de la
  // plateforme, pour en rejoindre une) — ici, uniquement les practices dont
  // l'utilisateur connecté est DÉJÀ membre (tout type), pour le dashboard
  // cabinet/CGA. Même gap que celui déjà comblé côté organisations
  // (OrganizationsService.listMine()) : rien n'exposait jusqu'ici "à
  // quelle(s) practice(s) appartient l'utilisateur connecté".
  async listMine(userId: string) {
    const memberships = await this.prisma.practiceMember.findMany({
      where: { userId, leftAt: null },
      include: { practice: true },
    });
    return memberships.map((membership) => ({ ...membership.practice, role: membership.role }));
  }

  // H3, ADR-071 — symétrique à OrganizationsService.upgradeCommercialTier()
  // (H2) : self-service, jamais un workflow d'approbation. tier jamais accepté
  // à create() (voir schema.prisma) mais changeable ici après coup.
  async upgradePartnerTier(practiceId: string, tier: ProfessionalPracticeTier, requesterUserId: string) {
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId);
    return this.prisma.professionalPractice.update({ where: { id: practiceId }, data: { tier } });
  }

  // H3, ADR-071 — n'affecte JAMAIS un RevenueShareCredit déjà généré, oriente
  // seulement RevenueShareService.getPartnerSubscriptionStatus() à la lecture.
  async upgradeRevenueShareSettlementMode(
    practiceId: string,
    mode: RevenueShareSettlementMode,
    requesterUserId: string,
  ) {
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId);
    return this.prisma.professionalPractice.update({
      where: { id: practiceId },
      data: { revenueShareSettlementMode: mode },
    });
  }
}
