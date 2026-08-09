import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { CreateMandateDto } from "./dto/create-mandate.dto";

@Injectable()
export class MandatesService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // Un mandat est une action PRACTICE-scopée, pas organisation-scopée (ADR-068) —
  // RolesGuard ne s'applique pas (il résout exclusivement une organisation via
  // OrganizationMember). Autorisation vérifiée en ligne, même précédent que
  // OrganizationsService.createAssisted() (isFieldAgent relu depuis la DB).
  // F5 se limite à la CRÉATION de la demande (status: pending) — l'acceptation
  // (pending → active) et la révocation (F6) sont des stories séparées, aucune
  // transition de status n'est construite ici.
  async create(practiceId: string, dto: CreateMandateDto, requesterUserId: string) {
    const member = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId: requesterUserId, leftAt: null },
    });
    if (!member || member.role !== "practice_admin") {
      throw new ForbiddenException(
        "Seul un practice_admin du cabinet peut demander un mandat au nom de celui-ci",
      );
    }

    const organization = await this.prisma.organization.findUnique({ where: { id: dto.organizationId } });
    if (!organization) {
      throw new NotFoundException(`Organisation ${dto.organizationId} introuvable`);
    }

    // Garde anti-doublon applicative (même précédent que C7/C13) — un mandat
    // revoked/expired ne bloque jamais une nouvelle demande, seuls pending/active
    // représentent une relation encore en cours.
    const existing = await this.prisma.mandate.findFirst({
      where: { practiceId, organizationId: dto.organizationId, status: { in: ["pending", "active"] } },
    });
    if (existing) {
      throw new ConflictException(
        `Un mandat ${existing.status} existe déjà entre ce cabinet et l'organisation ${dto.organizationId}`,
      );
    }

    return this.prisma.mandate.create({
      data: { practiceId, organizationId: dto.organizationId, grantedRole: dto.grantedRole },
    });
  }

  // F1, ADR-069 — "accorder l'accès" = l'action d'acceptation elle-même
  // (Mandate.grantedBy est documenté ERD comme "owner/admin qui a accepté").
  // Contrepartie de create() (F5, initiée par le cabinet) : ici l'organisation
  // ciblée accepte. Aucun rejet explicite construit (MandateStatus n'a pas de
  // valeur ERD pour ça) — laisser pending sans action est un rejet de facto.
  async accept(organizationId: string, mandateId: string, actorUserId: string) {
    const mandate = await this.prisma.mandate.findUnique({ where: { id: mandateId } });
    // Même mandat introuvable si le mandat existe mais cible une autre
    // organisation — jamais confirmer l'existence d'un mandat hors périmètre.
    if (!mandate || mandate.organizationId !== organizationId) {
      throw new NotFoundException(`Mandat ${mandateId} introuvable pour l'organisation ${organizationId}`);
    }

    if (mandate.status !== "pending") {
      throw new ConflictException(
        `Seul un mandat pending peut être accepté (statut actuel : ${mandate.status})`,
      );
    }

    return this.prisma.mandate.update({
      where: { id: mandateId },
      data: { status: "active", grantedBy: actorUserId, grantedAt: new Date() },
    });
  }

  // F6, ADR-069 — "Révocation par cabinet = tous les collaborateurs perdent
  // l'accès." Un seul acteur : practice_admin, même garde en ligne que create()
  // (F5). Seul un mandat active peut être révoqué — un pending n'a aucun accès à
  // perdre (laisser pending sans action reste le mécanisme d'abandon de F1),
  // revoked/expired sont déjà terminaux. grantedBy/grantedAt ne sont jamais
  // effacés : trace historique de qui avait accepté, conservée après révocation.
  async revoke(practiceId: string, mandateId: string, requesterUserId: string) {
    const member = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId: requesterUserId, leftAt: null },
    });
    if (!member || member.role !== "practice_admin") {
      throw new ForbiddenException(
        "Seul un practice_admin du cabinet peut révoquer un mandat au nom de celui-ci",
      );
    }

    const mandate = await this.prisma.mandate.findUnique({ where: { id: mandateId } });
    // Même mandat introuvable si le mandat existe mais est détenu par une autre
    // practice — jamais confirmer l'existence d'un mandat hors périmètre.
    if (!mandate || mandate.practiceId !== practiceId) {
      throw new NotFoundException(`Mandat ${mandateId} introuvable pour la practice ${practiceId}`);
    }

    if (mandate.status !== "active") {
      throw new ConflictException(
        `Seul un mandat active peut être révoqué (statut actuel : ${mandate.status})`,
      );
    }

    return this.prisma.mandate.update({
      where: { id: mandateId },
      data: { status: "revoked", revokedAt: new Date() },
    });
  }
}
