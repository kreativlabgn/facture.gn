import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { mandateNotExpiredWhere } from "../common/rbac/mandate-expiration";
import type { CreateMandateDto } from "./dto/create-mandate.dto";

@Injectable()
export class MandatesService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // Un mandat est une action PRACTICE-scopée, pas organisation-scopée (ADR-068) —
  // RolesGuard ne s'applique pas (il résout exclusivement une organisation via
  // OrganizationMember). Autorisation vérifiée en ligne, même précédent que
  // OrganizationsService.createAssisted() (isCommercialAgent relu depuis la DB).
  // Factorisé ici car utilisé par create() (F5) ET revoke() (F6) — même garde,
  // 2e occurrence identique, seuil "règle de trois" atteint (anticipé lors de la
  // revue F5).
  private async assertPracticeAdmin(practiceId: string, userId: string, action: string) {
    const member = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId, leftAt: null },
    });
    if (!member || member.role !== "practice_admin") {
      throw new ForbiddenException(`Seul un practice_admin du cabinet peut ${action}`);
    }
  }

  // Garde anti-doublon applicative (même précédent que C7/C13) — un mandat
  // revoked/expired ne bloque jamais une nouvelle demande, seuls pending/active
  // représentent une relation encore en cours. Factorisé ici car utilisé par
  // create() (F5) ET requestFromOrganization() (F12) — même garde, 2e occurrence
  // identique, seuil "règle de trois" atteint (même discipline déjà appliquée à
  // assertPracticeAdmin() ci-dessus).
  private async assertNoActiveMandate(practiceId: string, organizationId: string, entityLabel: string) {
    const existing = await this.prisma.mandate.findFirst({
      where: { practiceId, organizationId, status: { in: ["pending", "active"] } },
    });
    if (existing) {
      throw new ConflictException(
        `Un mandat ${existing.status} existe déjà entre ${entityLabel} et l'organisation ${organizationId}`,
      );
    }
  }

  // F5 se limite à la CRÉATION de la demande (status: pending) — l'acceptation
  // (pending → active) et la révocation (F6) sont des stories séparées, aucune
  // transition de status n'est construite ici.
  async create(practiceId: string, dto: CreateMandateDto, requesterUserId: string) {
    await this.assertPracticeAdmin(practiceId, requesterUserId, "demander un mandat au nom de celui-ci");

    const organization = await this.prisma.organization.findUnique({ where: { id: dto.organizationId } });
    if (!organization) {
      throw new NotFoundException(`Organisation ${dto.organizationId} introuvable`);
    }

    await this.assertNoActiveMandate(practiceId, dto.organizationId, "ce cabinet");

    return this.prisma.mandate.create({
      data: {
        practiceId,
        organizationId: dto.organizationId,
        grantedRole: dto.grantedRole,
        initiatedBy: "practice",
      },
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

    // F12 — défense en profondeur : un mandat initiatedBy "organization" doit
    // être accepté via acceptAsPractice(), jamais ici.
    if (mandate.initiatedBy !== "practice") {
      throw new ConflictException(
        "Ce mandat a été initié par l'organisation — seule la practice ciblée peut l'accepter",
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
    await this.assertPracticeAdmin(practiceId, requesterUserId, "révoquer un mandat au nom de celui-ci");

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

  // F7, ADR-070 — "Scope MVP réduit (consultation + FEC + switch)" exige
  // explicitement que accountant_external puisse consulter/switcher, pas
  // seulement practice_admin (contrairement à create()/revoke(), actions
  // administratives engageant le cabinet) — donc PAS assertPracticeAdmin() ici,
  // tout membre actif suffit.
  async listAccessibleOrganizations(practiceId: string, requesterUserId: string) {
    const member = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId: requesterUserId, leftAt: null },
    });
    if (!member) {
      throw new ForbiddenException("Seul un membre du cabinet peut consulter ses organisations accessibles");
    }

    return this.prisma.mandate.findMany({
      where: { practiceId, status: "active", ...mandateNotExpiredWhere() },
      include: { organization: { select: { id: true, name: true } } },
    });
  }

  // Écran "Mandats" du dashboard cabinet — distinct de listAccessibleOrganizations
  // (F7, actifs uniquement, sert le switch d'organisation) : ici pending ET active,
  // pour que le cabinet voie ses demandes en attente (F5, initiées par lui) et les
  // adhésions à accepter (F12, initiées par une organisation) — sans mandateId
  // visible ici, acceptAsPractice()/revoke() sont inappelables depuis l'UI.
  // revoked/expired exclus, bruit historique non actionnable.
  async listAll(practiceId: string, requesterUserId: string) {
    const member = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId: requesterUserId, leftAt: null },
    });
    if (!member) {
      throw new ForbiddenException("Seul un membre du cabinet peut consulter ses mandats");
    }

    return this.prisma.mandate.findMany({
      // Quality Audit 2026-08-23, finding #2 — pending n'a jamais accordé
      // d'accès (expiresAt n'est pertinent qu'une fois actif), donc pas de
      // filtre d'expiration sur cette branche ; active en revanche doit
      // rester soumis à la même garde que partout ailleurs.
      where: {
        practiceId,
        OR: [{ status: "pending" }, { status: "active", ...mandateNotExpiredWhere() }],
      },
      include: { organization: { select: { id: true, name: true } } },
    });
  }

  // F12, ADR-078 — "adhérer à un CGA" : sens d'initiation inverse de create()
  // (F5). Autorisation organisationnelle déjà garantie en amont par RolesGuard
  // (@Roles("owner","admin") + @OrganizationIdSource("organization")) — aucune
  // vérification de membership ici, contrairement à create()/assertPracticeAdmin
  // (practice-scoped). grantedRole fixé serveur (même restriction MVP qu'ADR-070),
  // jamais un choix exposé au client.
  async requestFromOrganization(organizationId: string, practiceId: string) {
    const practice = await this.prisma.professionalPractice.findUnique({ where: { id: practiceId } });
    if (!practice) {
      throw new NotFoundException(`Cabinet ${practiceId} introuvable`);
    }
    if (practice.type !== "cga") {
      throw new ConflictException(`Seul un CGA peut être rejoint par ce chemin (type actuel : ${practice.type})`);
    }

    await this.assertNoActiveMandate(practiceId, organizationId, "ce CGA");

    return this.prisma.mandate.create({
      data: { practiceId, organizationId, grantedRole: "accountant_external", initiatedBy: "organization" },
    });
  }

  // F12, ADR-078 — contrepartie de requestFromOrganization() : ici la practice
  // (CGA) accepte. Vérifie initiatedBy === "organization" — c'est CE check qui
  // empêche structurellement une practice de s'auto-accepter un mandat qu'elle a
  // elle-même créé via create() (F5), ce qui contournerait le consentement
  // organisationnel qu'ADR-069 est censé garantir.
  async acceptAsPractice(practiceId: string, mandateId: string, actorUserId: string) {
    await this.assertPracticeAdmin(practiceId, actorUserId, "accepter une adhésion au nom de celui-ci");

    const mandate = await this.prisma.mandate.findUnique({ where: { id: mandateId } });
    if (!mandate || mandate.practiceId !== practiceId) {
      throw new NotFoundException(`Mandat ${mandateId} introuvable pour la practice ${practiceId}`);
    }

    if (mandate.status !== "pending") {
      throw new ConflictException(
        `Seul un mandat pending peut être accepté (statut actuel : ${mandate.status})`,
      );
    }

    if (mandate.initiatedBy !== "organization") {
      throw new ConflictException(
        "Ce mandat a été initié par la practice elle-même — seule l'organisation ciblée peut l'accepter",
      );
    }

    return this.prisma.mandate.update({
      where: { id: mandateId },
      data: { status: "active", grantedBy: actorUserId, grantedAt: new Date() },
    });
  }

  // Option 5 USSD (§2.5 Spec USSD) — pendant que create()/accept()/revoke()
  // sont pensés practice-scopés (un cabinet gère SES mandats), rien jusqu'ici
  // ne permettait à une ORGANISATION de lister/révoquer côté sien. Seuls les
  // mandats initiatedBy "practice" (F5) sont acceptables PAR l'organisation —
  // ceux initiatedBy "organization" (F12) sont acceptés par la practice via
  // acceptAsPractice(), jamais listés ici.
  async listPendingForOrganization(organizationId: string) {
    return this.prisma.mandate.findMany({
      where: { organizationId, status: "pending", initiatedBy: "practice" },
      include: { practice: true },
    });
  }

  async listActiveForOrganization(organizationId: string) {
    return this.prisma.mandate.findMany({
      where: { organizationId, status: "active", ...mandateNotExpiredWhere() },
      include: { practice: true },
    });
  }

  // Symétrique de revoke() (practice-scopé) — ici l'organisation elle-même
  // révoque, même trio owner/admin que le reste des actions administratives
  // de ce repo (ex. merge() client, E4).
  async revokeAsOrganization(organizationId: string, mandateId: string, actorUserId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: actorUserId } },
    });
    if (!member || member.revokedAt || !["owner", "admin"].includes(member.role)) {
      throw new ForbiddenException("Seul un owner ou admin de l'organisation peut révoquer un mandat");
    }

    const mandate = await this.prisma.mandate.findUnique({ where: { id: mandateId } });
    if (!mandate || mandate.organizationId !== organizationId) {
      throw new NotFoundException(`Mandat ${mandateId} introuvable pour l'organisation ${organizationId}`);
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
