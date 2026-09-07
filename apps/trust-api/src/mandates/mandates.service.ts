import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import {
  organizationScopedClient,
  practiceScopedClient,
  type OrganizationScopedClient,
  type PracticeScopedClient,
} from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { mandateNotExpiredWhere } from "../common/rbac/mandate-expiration";
import { assertPracticeAdmin } from "../common/rbac/practice-access";
import type { CreateMandateDto } from "./dto/create-mandate.dto";

@Injectable()
export class MandatesService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // Garde anti-doublon applicative (même précédent que C7/C13) — un mandat
  // revoked/expired ne bloque jamais une nouvelle demande, seuls pending/active
  // représentent une relation encore en cours. Factorisé ici car utilisé par
  // create() (F5) ET requestFromOrganization() (F12) — même garde, 2e occurrence
  // identique, seuil "règle de trois" atteint (même discipline déjà appliquée à
  // assertPracticeAdmin() ci-dessus).
  // Reçoit le client déjà scopé de l'appelant plutôt que d'en choisir un :
  // create() appelle depuis le scope CABINET, requestFromOrganization() depuis
  // le scope ORGANISATION. Un scope choisi ici serait faux dans un cas sur deux.
  // Le `where` porte de toute façon les deux clés, c'est le filtre le plus
  // étroit possible.
  private async assertNoActiveMandate(
    client: OrganizationScopedClient | PracticeScopedClient,
    practiceId: string,
    organizationId: string,
    entityLabel: string,
  ) {
    const existing = await client.mandate.findFirst({
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
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId, "demander un mandat au nom de celui-ci");

    // Scope CABINET : c'est le cabinet qui demande le mandat.
    const scoped = practiceScopedClient(this.prisma, practiceId);
    // L'organisation est lue AVANT tout mandat — donc hors de toute délégation.
    // Sa politique org_isolation ne teste que app.current_org_id, nul ici, donc
    // la ligne reste visible sous scope cabinet. C'est ce qui permet de vérifier
    // qu'on ne demande pas un mandat sur une organisation inexistante.
    const organization = await scoped.organization.findFirst({ where: { id: dto.organizationId } });
    if (!organization) {
      throw new NotFoundException(`Organisation ${dto.organizationId} introuvable`);
    }

    await this.assertNoActiveMandate(scoped, practiceId, dto.organizationId, "ce cabinet");

    return scoped.mandate.create({
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
    // Scope ORGANISATION : c'est elle qui accepte le mandat proposé.
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const mandate = await scoped.mandate.findFirst({ where: { id: mandateId, organizationId } });
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

    // Quality Audit 2026-08-23, finding #4 — updateMany+where réclame la
    // transition atomiquement (au lieu d'un update() inconditionnel) : sous
    // deux acceptations/révocations concurrentes du même mandat, seule la
    // requête qui voit encore status="pending" au moment de l'écriture
    // committe — jamais une perte silencieuse de traçabilité d'audit
    // (grantedBy/grantedAt) sur un champ de conformité (accès cabinet
    // comptable aux données financières d'une PME).
    const claimed = await scoped.mandate.updateMany({
      where: { id: mandateId, organizationId, status: "pending" },
      data: { status: "active", grantedBy: actorUserId, grantedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException(`Mandat ${mandateId} déjà traité par une autre requête`);
    }
    return scoped.mandate.findFirstOrThrow({ where: { id: mandateId, organizationId } });
  }

  // F6, ADR-069 — "Révocation par cabinet = tous les collaborateurs perdent
  // l'accès." Un seul acteur : practice_admin, même garde en ligne que create()
  // (F5). Seul un mandat active peut être révoqué — un pending n'a aucun accès à
  // perdre (laisser pending sans action reste le mécanisme d'abandon de F1),
  // revoked/expired sont déjà terminaux. grantedBy/grantedAt ne sont jamais
  // effacés : trace historique de qui avait accepté, conservée après révocation.
  async revoke(practiceId: string, mandateId: string, requesterUserId: string) {
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId, "révoquer un mandat au nom de celui-ci");

    const scoped = practiceScopedClient(this.prisma, practiceId);
    // practiceId dans le where : tant que RLS dort, c'est la seule barrière —
    // et la table mandate reste hors du prédicat practice même une fois RLS
    // actif (voir la migration 20260905120000, qui ne l'inclut pas).
    const mandate = await scoped.mandate.findFirst({ where: { id: mandateId, practiceId } });
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

    // Quality Audit 2026-08-23, finding #4 — voir accept() ci-dessus pour la
    // justification complète du pattern.
    const claimed = await scoped.mandate.updateMany({
      where: { id: mandateId, practiceId, status: "active" },
      data: { status: "revoked", revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException(`Mandat ${mandateId} déjà traité par une autre requête`);
    }
    return scoped.mandate.findFirstOrThrow({ where: { id: mandateId, practiceId } });
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

    return practiceScopedClient(this.prisma, practiceId).mandate.findMany({
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

    return practiceScopedClient(this.prisma, practiceId).mandate.findMany({
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
    // Scope ORGANISATION : ici c'est l'organisation qui adhère à un CGA.
    // professional_practice est HORS RLS (annuaire des cabinets, partagé) —
    // lecture non scopée à dessein.
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const practice = await this.prisma.professionalPractice.findUnique({ where: { id: practiceId } });
    if (!practice) {
      throw new NotFoundException(`Cabinet ${practiceId} introuvable`);
    }
    if (practice.type !== "cga") {
      throw new ConflictException(`Seul un CGA peut être rejoint par ce chemin (type actuel : ${practice.type})`);
    }

    await this.assertNoActiveMandate(scoped, practiceId, organizationId, "ce CGA");

    return scoped.mandate.create({
      data: { practiceId, organizationId, grantedRole: "accountant_external", initiatedBy: "organization" },
    });
  }

  // F12, ADR-078 — contrepartie de requestFromOrganization() : ici la practice
  // (CGA) accepte. Vérifie initiatedBy === "organization" — c'est CE check qui
  // empêche structurellement une practice de s'auto-accepter un mandat qu'elle a
  // elle-même créé via create() (F5), ce qui contournerait le consentement
  // organisationnel qu'ADR-069 est censé garantir.
  async acceptAsPractice(practiceId: string, mandateId: string, actorUserId: string) {
    await assertPracticeAdmin(this.prisma, practiceId, actorUserId, "accepter une adhésion au nom de celui-ci");

    const scoped = practiceScopedClient(this.prisma, practiceId);
    const mandate = await scoped.mandate.findFirst({ where: { id: mandateId, practiceId } });
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

    // Quality Audit 2026-08-23, finding #4 — voir accept() plus haut pour la
    // justification complète du pattern.
    const claimed = await scoped.mandate.updateMany({
      where: { id: mandateId, practiceId, status: "pending" },
      data: { status: "active", grantedBy: actorUserId, grantedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException(`Mandat ${mandateId} déjà traité par une autre requête`);
    }
    return scoped.mandate.findFirstOrThrow({ where: { id: mandateId, practiceId } });
  }

  // Option 5 USSD (§2.5 Spec USSD) — pendant que create()/accept()/revoke()
  // sont pensés practice-scopés (un cabinet gère SES mandats), rien jusqu'ici
  // ne permettait à une ORGANISATION de lister/révoquer côté sien. Seuls les
  // mandats initiatedBy "practice" (F5) sont acceptables PAR l'organisation —
  // ceux initiatedBy "organization" (F12) sont acceptés par la practice via
  // acceptAsPractice(), jamais listés ici.
  async listPendingForOrganization(organizationId: string) {
    return organizationScopedClient(this.prisma, organizationId).mandate.findMany({
      where: { organizationId, status: "pending", initiatedBy: "practice" },
      include: { practice: true },
    });
  }

  async listActiveForOrganization(organizationId: string) {
    return organizationScopedClient(this.prisma, organizationId).mandate.findMany({
      where: { organizationId, status: "active", ...mandateNotExpiredWhere() },
      include: { practice: true },
    });
  }

  // Symétrique de revoke() (practice-scopé) — ici l'organisation elle-même
  // révoque, même trio owner/admin que le reste des actions administratives
  // de ce repo (ex. merge() client, E4).
  async revokeAsOrganization(organizationId: string, mandateId: string, actorUserId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    // organization_member EST sous org_isolation : lecture scopée.
    const member = await scoped.organizationMember.findFirst({
      where: { organizationId, userId: actorUserId },
    });
    if (!member || member.revokedAt || !["owner", "admin"].includes(member.role)) {
      throw new ForbiddenException("Seul un owner ou admin de l'organisation peut révoquer un mandat");
    }

    const mandate = await scoped.mandate.findFirst({ where: { id: mandateId, organizationId } });
    if (!mandate || mandate.organizationId !== organizationId) {
      throw new NotFoundException(`Mandat ${mandateId} introuvable pour l'organisation ${organizationId}`);
    }

    if (mandate.status !== "active") {
      throw new ConflictException(
        `Seul un mandat active peut être révoqué (statut actuel : ${mandate.status})`,
      );
    }

    // Quality Audit 2026-08-23, finding #4 — voir accept() plus haut pour la
    // justification complète du pattern.
    const claimed = await scoped.mandate.updateMany({
      where: { id: mandateId, organizationId, status: "active" },
      data: { status: "revoked", revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException(`Mandat ${mandateId} déjà traité par une autre requête`);
    }
    return scoped.mandate.findFirstOrThrow({ where: { id: mandateId, organizationId } });
  }
}
