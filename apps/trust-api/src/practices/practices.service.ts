import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  PrismaClient,
  ProfessionalPracticeTier,
  ProfessionalPracticeType,
  RevenueShareSettlementMode,
} from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { assertPracticeAdmin } from "../common/rbac/practice-access";
import {
  getPartnerTierMaxOrganizations,
  tierAccepteOrganisations,
} from "./partner-tier-grid";
import type { CreatePracticeDto } from "./dto/create-practice.dto";
import type { InviteMemberDto } from "./dto/invite-member.dto";

// RLS (ADR-111 étape 1) — CARTE DU MODULE. Constat vérifié le 2026-09-06 :
// AUCUN accès de ce service n'est scopable, et ce n'est pas un report.
//
// 1. `professional_practice` et `practice_member` sont HORS RLS. Ni l'une ni
//    l'autre n'apparaît dans un `ENABLE ROW LEVEL SECURITY` des migrations, et
//    aucune politique ne les vise. Il n'existe PAS de politique
//    `practice_isolation` : la migration 20260905120000 explique explicitement
//    pourquoi une seconde politique serait INCORRECTE (sous PostgreSQL, deux
//    politiques permissives sont OU-ées — une politique cabinet dormante
//    renverrait TRUE pour toutes les lignes dès qu'une requête ne pose que
//    app.current_org_id, neutralisant le filtre organisation). Le scope cabinet
//    passe donc par le prédicat COMBINÉ des tables métier (mandate, invoice,
//    customer…), jamais par une politique propre aux tables du cabinet.
//    Conséquence : appeler practiceScopedClient() ici poserait un GUC qu'aucune
//    politique ne lit — inopérant, et trompeur pour qui relira ce fichier.
//
// 2. `user_phone` est hors RLS lui aussi (identité partagée).
//
// 3. La SEULE table sous RLS touchée ici est `organization`, via
//    lookupOrganizationByNif() — et cette lecture doit rester GLOBALE : c'est
//    l'annuaire NIF, interrogé par un cabinet qui n'est pas encore mandaté sur
//    l'organisation cherchée. La scoper la rendrait aveugle, donc inutile. Ses
//    quatre barrières (correspondance exacte, select réduit, practice_admin,
//    throttle) sont documentées sur la méthode elle-même.
//
// Aucun setPracticeScope() dans create() non plus : sa transaction ne touche que
// les deux tables hors RLS ci-dessus, et la practice n'existe pas avant son
// propre create() (même œuf-et-poule qu'OrganizationsService.create()).
//
// À ARBITRER POUR L'ÉTAPE 2 (hors périmètre de l'étape 1, aucune migration ici) :
// laisser `practice_member` hors RLS signifie qu'après la bascule vers
// facture_app (NOBYPASSRLS), la composition de TOUS les cabinets restera lisible
// par n'importe quel chemin applicatif qui atteint cette table. C'est peut-être
// voulu (annuaire partagé, comme `user`), mais ça n'a jamais été tranché
// explicitement — voir docs/runbooks/rls-rollout.md.
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

  // DÉPART D'UN COLLABORATEUR — la contrepartie du mandat accordé à l'ENTITÉ.
  //
  // C'est ce qui donne son sens à toute l'architecture (ADR-068) : l'accès aux
  // clients ne passe par aucune membership individuelle, donc faire partir un
  // collaborateur coupe TOUS ses accès d'un seul coup, sans avoir à parcourir
  // les mandats un par un. Encore fallait-il pouvoir le faire partir : rien
  // n'écrivait jamais `leftAt` — dix lectures dans le dépôt, aucune écriture.
  // La garantie était énoncée, pas outillée.
  //
  // On POSE une date, on ne SUPPRIME pas la ligne. Un cabinet doit pouvoir dire
  // qui suivait tel dossier l'an dernier ; effacer l'appartenance effacerait
  // aussi cette réponse.
  async revokeMember(practiceId: string, memberUserId: string, requesterUserId: string) {
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId, "retirer un collaborateur");

    const membership = await this.prisma.practiceMember.findFirst({
      where: { practiceId, userId: memberUserId, leftAt: null },
    });
    if (!membership) {
      throw new NotFoundException("Ce collaborateur n'est pas membre actif du cabinet");
    }

    // Retirer le DERNIER administrateur laisserait un cabinet que plus personne
    // ne peut administrer : ni inviter, ni demander un mandat, ni changer de
    // palier. Le cas est atteignable en un clic (un associé unique qui se
    // retire lui-même), et il est irréversible sans intervention manuelle.
    if (membership.role === "practice_admin") {
      const autresAdmins = await this.prisma.practiceMember.count({
        where: { practiceId, role: "practice_admin", leftAt: null, userId: { not: memberUserId } },
      });
      if (autresAdmins === 0) {
        throw new ConflictException(
          "Ce cabinet n'aurait plus aucun administrateur — nommez-en un autre avant de retirer celui-ci",
        );
      }
    }

    return this.prisma.practiceMember.update({
      where: { id: membership.id },
      data: { leftAt: new Date() },
    });
  }

  // F12, ADR-078 — "liste des CGA actifs" : ProfessionalPractice n'a aucun
  // concept "actif/inactif" scaffoldé, toute practice existante du type demandé
  // est retournée. Scope à "cga" uniquement pour cette story (jamais généralisé).
  // ANNUAIRE PUBLIC : lisible par n'importe quel utilisateur authentifié, sans
  // aucune appartenance. La projection est donc EXPLICITE, jamais la ligne
  // entière — un findMany nu exposait `tier` et `revenueShareSettlementMode`,
  // c'est-à-dire le palier commercial d'un partenaire et la façon dont il est
  // rémunéré. Ce sont ses conditions d'affaires : un concurrent inscrit sur la
  // plateforme pouvait les lire d'une requête.
  //
  // Ce qui reste est ce qu'un adhérent doit voir pour CHOISIR un CGA : de quoi
  // l'identifier (nom, agrément), savoir s'il est vérifié, et le contacter.
  async findAllByType(type: ProfessionalPracticeType) {
    return this.prisma.professionalPractice.findMany({
      where: { type },
      select: {
        id: true,
        name: true,
        type: true,
        // Numéro d'agrément et vérification par l'Ordre : des signaux de
        // confiance, publics par nature — c'est leur raison d'être.
        registrationNumber: true,
        ordreVerified: true,
        phone: true,
        email: true,
      },
      orderBy: { name: "asc" },
    });
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
      // ORDRE DÉTERMINISTE, et ce n'est pas cosmétique. Sans orderBy, Postgres
      // rend les lignes dans l'ordre qui l'arrange, et il peut changer d'une
      // requête à l'autre. Or l'appelant se pose sur le PREMIER cabinet : un
      // collaborateur membre de deux structures atterrissait donc tantôt dans
      // la sienne, tantôt dans celle d'un confrère où il n'est qu'invité —
      // sans rien avoir demandé, et sans que l'écran le dise.
      //
      // Le plus ancien rattachement d'abord : c'est le cabinet d'origine, celui
      // qu'on a rejoint en premier, et il ne bouge plus.
      orderBy: { joinedAt: "asc" },
    });
    return memberships.map((membership) => ({ ...membership.practice, role: membership.role }));
  }

  // H3, ADR-071 — symétrique à OrganizationsService.upgradeCommercialTier()
  // (H2) : self-service, jamais un workflow d'approbation. tier jamais accepté
  // à create() (voir schema.prisma) mais changeable ici après coup.
  async upgradePartnerTier(practiceId: string, tier: ProfessionalPracticeTier, requesterUserId: string) {
    await assertPracticeAdmin(this.prisma, practiceId, requesterUserId);

    // LE SENS DESCENDANT COMPTE AUTANT QUE L'ASCENDANT. Sans ce garde, un
    // partenaire Pro suivant quatre-vingts entreprises pouvait retomber en Free
    // et les garder toutes : le plafond posé à la demande de mandat aurait été
    // contourné par la porte de derrière, en une requête.
    //
    // On ne révoque AUCUN mandat pour faire rentrer le cabinet dans son
    // nouveau palier : couper l'accès d'un comptable à ses clients parce qu'il
    // a changé d'abonnement serait une décision commerciale déguisée en effet
    // de bord. On refuse le changement, et on dit ce qu'il faudrait faire.
    const suivies = await this.prisma.mandate.count({
      where: { practiceId, status: { in: ["pending", "active"] } },
    });
    if (!tierAccepteOrganisations(tier, suivies)) {
      const plafond = getPartnerTierMaxOrganizations(tier);
      throw new ConflictException(
        `Le palier ${tier} est limité à ${plafond} entreprise${(plafond ?? 0) > 1 ? "s" : ""}, ` +
          `et ce cabinet en suit ${suivies}. Révoquez des mandats avant de rétrograder.`,
      );
    }

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

  // Annuaire NIF → organisation, pour le rattachement d'un mandat (Chantier C).
  // Un cabinet connaît le NIF de son client, jamais son UUID interne.
  //
  // C'est un endpoint d'ANNUAIRE : mal conçu, il énumère les contribuables
  // guinéens. Quatre barrières, toutes nécessaires :
  //
  //  1. findUnique sur `nif`, colonne @unique — correspondance EXACTE. Jamais
  //     de `contains`/`startsWith`, qui permettraient de balayer l'espace des
  //     NIF par préfixes.
  //  2. `select` réduit à l'id et au nom. Le régime fiscal, le chiffre
  //     d'affaires déclaré, le palier commercial ou le statut DGI ne
  //     ressortent pas d'ici — celui qui cherche n'est pas encore mandaté.
  //  3. Réservé aux practice_admin (garde ci-dessous).
  //  4. Throttle strict sur la route (voir practices.controller.ts).
  //
  // Le garde diffère d'assertPracticeAdmin() : la route ne porte aucun
  // practiceId — la recherche précède le choix du cabinet dans le formulaire.
  // On exige donc d'être practice_admin d'AU MOINS un cabinet actif. C'est le
  // même niveau d'exigence, appliqué à l'utilisateur plutôt qu'au couple
  // (utilisateur, cabinet).
  //
  // RLS — `organization` EST sous RLS, mais cette lecture reste GLOBALE à
  // dessein : le cabinet qui cherche n'est pas encore mandaté sur l'organisation
  // qu'il cherche, un scope la lui masquerait et viderait l'annuaire de son sens.
  // Même famille que OrganizationsService.createFromApip() et
  // AuthService.requestRecovery() — le NIF est le point d'entrée d'un annuaire,
  // jamais une donnée déjà scopée.
  async lookupOrganizationByNif(nif: string, requesterUserId: string) {
    const adminMembership = await this.prisma.practiceMember.findFirst({
      where: { userId: requesterUserId, leftAt: null, role: "practice_admin" },
      select: { id: true },
    });
    if (!adminMembership) {
      throw new ForbiddenException("Seul un practice_admin peut rechercher une organisation par NIF");
    }

    const organization = await this.prisma.organization.findUnique({
      where: { nif },
      select: { id: true, name: true },
    });
    if (!organization) {
      // Message neutre : il ne dit pas si le NIF est inconnu du système ou
      // simplement non renseigné sur une organisation existante.
      throw new NotFoundException("Aucune organisation ne correspond à ce NIF");
    }

    return organization;
  }
}
