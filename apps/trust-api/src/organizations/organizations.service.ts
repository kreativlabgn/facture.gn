import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InvoiceEventType, type CommercialTier, type PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { isRoleAllowedForTier, maxMembersForTier } from "../common/plan-features-grid";
import { OrganizationSigningKeyService } from "../certification/organization-signing-key.service";
import { PendingMemberInviteService } from "../pending-member-invites/pending-member-invite.service";
import { generateAccountCode } from "./account-code";
import type { CreateOrganizationDto } from "./dto/create-organization.dto";
import type { CreateAssistedOrganizationDto } from "./dto/create-assisted-organization.dto";
import type { CreateFromApipDto } from "./dto/create-from-apip.dto";
import type { InviteOrganizationMemberDto } from "./dto/invite-organization-member.dto";

const MAX_ACCOUNT_CODE_ATTEMPTS = 3;
const DEFAULT_LIST_PAGE_SIZE = 50;
const MAX_LIST_PAGE_SIZE = 100;
// Security Audit 2026-08-23, finding #8 — durée arbitraire faute de spec ADR/
// Backlog fixant une durée pour l'inscription assistée, ajustable en ce point
// unique. Un consentement d'inscription ponctuel ne doit pas rester une porte
// d'émission permanente pour l'agent terrain.
const ASSISTED_SESSION_TTL_MS = 90 * 24 * 60 * 60_000;

// G4, ADR-097 — mapping statique, jugement de classification documenté ici plutôt
// qu'un contrat de spec figé (voir PLAN "Risques"). "paiement" = tout événement lié
// à un mouvement ou une communication d'argent ; "facture" = tout le reste du cycle
// de vie du document. Record<InvoiceEventType, ...> plutôt qu'une liste + complément :
// le compilateur refuse toute build tant qu'un futur type ajouté à l'enum n'a pas
// une entrée explicite ici — la classification ne peut jamais diverger en silence.
const EVENT_CATEGORY_BY_TYPE: Record<InvoiceEventType, "facture" | "paiement"> = {
  cancellation_indemnity: "facture",
  no_show_forfeited: "facture",
  dispute_raised: "facture",
  dispute_resolved: "facture",
  payment_reminder_sent: "paiement",
  payment_link_generated: "paiement",
  payment_link_expired: "paiement",
  payment_link_regenerated: "paiement",
  invoice_voided: "facture",
  invoice_converted: "facture",
  overpayment_recorded: "paiement",
  refund_issued: "paiement",
  suspicious_cash_pattern_detected: "paiement",
  stale_invoice_detected: "facture",
  mandate_requested: "facture",
  mandate_granted: "facture",
  mandate_revoked: "facture",
  mandate_expired: "facture",
  revenue_share_credited: "paiement",
  regime_change: "facture",
  delegated_key_tier_changed: "facture",
  validation_revoked: "facture",
  // K4/K5, ADR-088/089 — avance d'un montant réel par un partenaire financier :
  // un mouvement d'argent, pas un événement de cycle de vie du document.
  financing_disbursed: "paiement",
  liquidation_validated: "facture",
};

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly signingKeyService: OrganizationSigningKeyService,
    private readonly pendingMemberInvite: PendingMemberInviteService,
  ) {}

  // Le créateur devient owner dans la même transaction — aucune organisation ne
  // doit exister sans au moins un membre pouvant en gérer les accès.
  //
  // RLS (ADR-111 étape 1) — AUCUN scope posé ici, à dessein : l'organisation
  // n'existe pas encore, son id n'est connu qu'après le create(). Poser
  // app.current_org_id sur un id inventé ferait échouer le WITH CHECK de la
  // politique org_isolation. Les deux GUC restent nuls → branche dormante du
  // prédicat, l'INSERT passe, y compris après l'étape 2 (facture_app).
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
        // A3, ADR-026 — "identité cryptographique unique" par organisation, jamais
        // une organisation sans clé : provisionnée dans la MÊME transaction.
        await this.signingKeyService.provisionRootKey(organization.id, tx);
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
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const organization = await scoped.organization.findFirstOrThrow({
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

    const verified = await scoped.organization.update({
      where: { id: organizationId },
      data: { dgiVerificationStatus: "verified", dgiVerifiedAt: new Date() },
    });

    // Traçabilité (revue sécurité B2) : seule trace de qui/quand une organisation a
    // été élevée à verified — jamais de NIF/eTax ici, uniquement l'id, déjà non
    // sensible seul (UUID opaque).
    this.logger.log(`Organisation ${organizationId} vérifiée DGI (dgi_verification_status → verified)`);

    return verified;
  }

  // ADR-045/046/047, B5, ADR-107 — Chemin B : l'Agent commercial terrain saisit
  // l'inscription à la place du marchand. isCommercialAgent est rechargé depuis la
  // DB (jamais fait confiance au JWT/params) : c'est la seule frontière
  // d'autorisation ici, RolesGuard ne couvre pas ce statut plateforme (sans rapport
  // avec OrganizationRole.field_agent, personnel de la PME). Le marchand créé
  // (passwordHash: null, comme tout placeholder Chemin B) devient owner — jamais
  // l'agent lui-même, qui n'obtient aucune OrganizationMember : AssistedSession est
  // la seule preuve du lien agent↔organisation (voir schema.prisma).
  // registrationSource=agent_terrain (ADR-107) : avant correctif, retombait
  // silencieusement sur le défaut "organic" du schema — organisations mal étiquetées.
  async createAssisted(commercialAgentUserId: string, dto: CreateAssistedOrganizationDto) {
    // `user` est HORS RLS (identité plateforme) et l'agent terrain n'appartient
    // à AUCUNE organisation — AssistedSession est le seul lien. Lecture globale
    // à dessein.
    const agent = await this.prisma.user.findUniqueOrThrow({ where: { id: commercialAgentUserId } });
    if (!agent.isCommercialAgent) {
      throw new ForbiddenException("Seul un agent terrain peut créer une organisation en inscription assistée");
    }

    if (dto.msisdn) {
      // Contrôle d'unicité GLOBALE de l'annuaire : la question est « ce numéro
      // a-t-il DÉJÀ un compte, où que ce soit ». Scoper cette lecture la rendrait
      // aveugle aux comptes des autres organisations et laisserait créer un
      // doublon — même piège que le NIF dans createFromApip() ci-dessous.
      // `user_phone` est de toute façon hors RLS (identité partagée).
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
        // RLS — aucun scope posé (même raison que create() : l'organisation naît
        // ici). Un setOrganizationScope() posé APRÈS le create() serait pire que
        // rien : resolveForNewUser() résout des PendingMemberInvite émises par
        // d'AUTRES organisations pour ce marchand, que le scope masquerait.
        return await this.prisma.$transaction(async (tx) => {
          const organization = await tx.organization.create({
            data: {
              name: dto.organizationName,
              regimeFiscal: dto.regimeFiscal,
              legalForm: dto.legalForm,
              nif: dto.nif,
              etaxNumber: dto.etaxNumber,
              accountCode: generateAccountCode(),
              registrationSource: "agent_terrain",
            },
          });

          const merchant = await tx.user.create({ data: { name: dto.merchantName, passwordHash: null } });

          if (dto.msisdn) {
            await tx.userPhone.create({ data: { userId: merchant.id, msisdn: dto.msisdn, isPrimary: true } });
            // F10 — résout toute PendingMemberInvite en attente pour ce numéro
            // (une organisation/cabinet distinct a pu inviter ce même
            // marchand avant qu'il ne soit inscrit assistée ici).
            await this.pendingMemberInvite.resolveForNewUser(tx, merchant.id, dto.msisdn);
          }

          await tx.organizationMember.create({
            data: { organizationId: organization.id, userId: merchant.id, role: "owner" },
          });

          await tx.assistedSession.create({
            data: {
              commercialAgentUserId,
              organizationId: organization.id,
              consentRecordedAt: new Date(),
              expiresAt: new Date(Date.now() + ASSISTED_SESSION_TTL_MS),
            },
          });

          // A3, ADR-026 — même discipline que create() : jamais une organisation
          // sans clé, provisionnée dans la même transaction.
          await this.signingKeyService.provisionRootKey(organization.id, tx);

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
    // `payment` est sous RLS par INDIRECTION (politique via invoice_id) : le
    // scope org s'y applique, et `invoice: { organizationId }` reste la garde
    // explicite tant que les politiques dorment.
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const [total, verified] = await Promise.all([
      scoped.payment.aggregate({
        _sum: { amount: true },
        where: { invoice: { organizationId }, depositType: null },
      }),
      scoped.payment.aggregate({
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
      // RLS — aucun scope posé (même raison que create()/createAssisted()).
      return await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: dto.name,
            regimeFiscal: dto.regimeFiscal,
            legalForm: dto.legalForm,
            nif: dto.nif,
            rccm: dto.rccm,
            registrationSource: "apip",
          },
        });
        // A3, ADR-026 — même discipline que create()/createAssisted(). Jamais sur
        // la branche idempotente ci-dessous : provisionner une 2e clé ACTIVE pour
        // une organisation qui en a déjà une violerait l'index unique partiel
        // organization_signing_key_one_active_per_org (E3/ADR-114) et casserait
        // la redélivraison webhook (ADR-016). L'organisation est fraîche par
        // transaction ici → non atteignable, l'index reste le filet.
        await this.signingKeyService.provisionRootKey(organization.id, tx);
        return organization;
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error, "nif")) {
        // NE JAMAIS SCOPER CETTE LECTURE. C'est une recherche d'unicité
        // GLOBALE sur le NIF : on vient précisément de percuter la contrainte
        // unique, donc l'organisation existante appartient par définition à
        // quelqu'un d'autre que le scope courant (il n'y en a d'ailleurs aucun
        // ici — webhook APIP signé, pas de requête organisationnelle). Scopée,
        // elle ne trouverait rien et lèverait à la place de rendre la
        // sémantique idempotente attendue par la redélivraison (ADR-016).
        return this.prisma.organization.findUniqueOrThrow({ where: { nif: dto.nif } });
      }
      throw error;
    }
  }

  // Aucun endpoint n'exposait jusqu'ici "à quelle(s) organisation(s) appartient
  // l'utilisateur connecté" — CurrentUser ne porte que { id } (JWT { sub }), et
  // toutes les routes RBAC existantes exigent déjà de connaître l'organisation
  // ciblée. Filtré côté requête (revokedAt: null), jamais côté application —
  // même discipline que RolesGuard.
  // Quality Audit 2026-08-23, finding #5 — select explicite plutôt que
  // "organization: true" (l'entité complète) : accessible à TOUT membre actif
  // quel que soit son rôle (aucun @Roles() sur cette route), alors que
  // bankAccountDetails/chiffreAffairesBrutDeclare sont explicitement jugés
  // sensibles ailleurs dans ce même fichier (voir findOneDetail() ci-dessous,
  // restreint owner/admin pour ces mêmes champs). Exclut aussi
  // creditLimitApprovalThreshold/commissionBypassLevel/
  // commissionBypassProofThresholdOverrideGnf — configuration financière/anti-
  // fraude interne, même niveau de sensibilité, jamais un simple collaborateur.
  async listMine(userId: string) {
    // NON SCOPÉE à dessein : c'est LA requête de découverte du scope — « à
    // quelles organisations cet utilisateur appartient-il ». Aucune
    // organisation courante n'existe encore à ce stade (route sans @Roles()),
    // et un scope quelconque réduirait la réponse à cette seule organisation.
    // Même famille que le contrôle de NIF et l'annuaire téléphone ci-dessus.
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId, revokedAt: null },
      select: {
        role: true,
        organization: {
          select: {
            id: true,
            name: true,
            regimeFiscal: true,
            legalForm: true,
            nif: true,
            etaxNumber: true,
            rccm: true,
            registrationSource: true,
            dgiVerificationStatus: true,
            dgiVerifiedAt: true,
            preferredLanguage: true,
            paymentLinkAutoSend: true,
            commercialTier: true,
            createdAt: true,
            accountCode: true,
            paymentsFrozenUntil: true,
          },
        },
      },
    });
    return memberships.map((membership) => ({ ...membership.organization, role: membership.role }));
  }

  // Détail organisation (paramètres) — même trio owner/admin que trust-score
  // (E8, organizations.controller.ts:64) : ces deux routes exposent des champs
  // de sensibilité comparable (bankAccountDetails, chiffreAffairesBrutDeclare).
  async findOneDetail(organizationId: string) {
    // RÈGLE — à travers un client scopé : findFirst*, jamais findUnique*.
    // Tant que les politiques dorment, le `where` est la seule barrière réelle,
    // et findFirst est la seule forme qui puisse toujours y porter la colonne
    // de scope (findUnique n'accepte qu'une clé unique). L'appliquer sans
    // exception rend l'audit greppable, au lieu d'un jugement site par site
    // sur « cette clé unique contient-elle déjà organizationId ? ».
    return organizationScopedClient(this.prisma, organizationId).organization.findFirstOrThrow({
      where: { id: organizationId },
    });
  }

  // G4, ADR-097 — auditor (ou owner/admin) : lecture seule stricte, aucune
  // exception. Scopé via invoice.organizationId (invoice_event n'a pas de FK
  // organisation directe) — même relation que getVerifiedPaymentRatio() ci-dessus.
  // "permission" n'est volontairement pas une valeur de category acceptée ici :
  // aucun historique de changement de rôle n'existe encore dans ce repo (voir
  // PLAN "Alternatives écartées") — l'exposer renverrait une liste vide qui
  // masquerait silencieusement ce trou plutôt que de le rendre visible.
  async listAuditLog(organizationId: string, filters: { category?: "facture" | "paiement"; take?: number; skip?: number }) {
    const take = Math.min(filters.take ?? DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
    const skip = filters.skip ?? 0;

    const where: { invoice: { organizationId: string }; type?: { in: InvoiceEventType[] } } = {
      invoice: { organizationId },
    };
    if (filters.category) {
      const matchingTypes = Object.values(InvoiceEventType).filter(
        (type) => EVENT_CATEGORY_BY_TYPE[type] === filters.category,
      );
      where.type = { in: matchingTypes };
    }

    // invoice_event : sous RLS par indirection (politique via invoice_id).
    return organizationScopedClient(this.prisma, organizationId).invoiceEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
    });
  }

  // F14, ADR-104 — première story à construire un mécanisme d'invitation au
  // niveau organisation (jusqu'ici, seul role: "owner" était créé, à la
  // création). Même pattern que PracticesService.inviteMember() (F8) :
  // résolution par UserPhone, aucun flux d'acceptation, ajout immédiat.
  // L'invité doit déjà avoir un compte facture.gn — inviter un utilisateur sans
  // compte est un mécanisme distinct (F10/ADR-096), hors scope ici.
  async inviteMember(organizationId: string, dto: InviteOrganizationMemberDto, requesterUserId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    // Security Audit 2026-08-23, finding #12 — @Roles("owner","admin") sur la
    // route (RolesGuard) autorise un simple admin à appeler cet endpoint, mais
    // seul le owner peut inviter un pair admin ou approver (rôle de contrôle
    // financier — E5, seul habilité à résoudre les hausses de limite de crédit) :
    // décision produit actée, pas seulement une restriction technique. Vérifié
    // avant tout le reste (moins coûteux, échoue au plus tôt).
    if (dto.role === "admin" || dto.role === "approver") {
      const requesterMembership = await scoped.organizationMember.findFirst({
        where: { organizationId, userId: requesterUserId },
      });
      if (requesterMembership?.role !== "owner") {
        throw new ForbiddenException(`Seul le owner peut inviter un membre avec le rôle ${dto.role}`);
      }
    }

    const organization = await scoped.organization.findFirstOrThrow({ where: { id: organizationId } });
    // H1, Grille §2 — vérifié avant le comptage des collaborateurs (moins
    // coûteux) : un rôle non débloqué par le palier ne doit jamais consommer
    // le quota de collaborateurs pour rien.
    if (!isRoleAllowedForTier(dto.role, organization.commercialTier)) {
      throw new ForbiddenException(
        `Le rôle ${dto.role} nécessite un palier commercial supérieur à ${organization.commercialTier}`,
      );
    }

    const maxMembers = maxMembersForTier(organization.commercialTier);
    if (maxMembers !== null) {
      const activeMemberCount = await scoped.organizationMember.count({
        where: { organizationId, revokedAt: null },
      });
      if (activeMemberCount >= maxMembers) {
        throw new ForbiddenException(
          `Palier ${organization.commercialTier} limité à ${maxMembers} collaborateur(s) — upgrade requis`,
        );
      }
    }

    // Annuaire GLOBAL, non scopé à dessein (voir createAssisted()) : la
    // question est « ce numéro a-t-il un compte facture.gn », pas « dans cette
    // organisation ». `user_phone` est hors RLS.
    const userPhone = await this.prisma.userPhone.findUnique({ where: { msisdn: dto.msisdn } });
    if (!userPhone) {
      throw new NotFoundException(`Compte introuvable pour le numéro ${dto.msisdn}`);
    }

    // Contrainte unique (organizationId, userId) permanente (pas de "leftAt"
    // comme PracticeMember, seulement revokedAt) : une ligne existante, même
    // révoquée, bloque toute nouvelle invitation — pas de réactivation
    // silencieuse (voir PLAN "Alternatives écartées").
    const existingMembership = await scoped.organizationMember.findFirst({
      where: { organizationId, userId: userPhone.userId },
    });
    if (existingMembership) {
      throw new ConflictException(`Cet utilisateur est déjà membre de l'organisation ${organizationId}`);
    }

    try {
      return await scoped.organizationMember.create({
        data: { organizationId, userId: userPhone.userId, role: dto.role },
      });
    } catch (error) {
      // Le findUnique ci-dessus ne protège pas contre deux invitations
      // concurrentes du même utilisateur — la contrainte unique
      // (organizationId, userId) reste le seul garde-fou réel sous concurrence.
      // Catch générique (pas isUniqueConstraintViolation) : cette table n'a
      // qu'une seule contrainte unique possible ici, aucune ambiguïté sur la
      // cause d'un P2002 à ce point du code.
      if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
        throw new ConflictException(`Cet utilisateur est déjà membre de l'organisation ${organizationId}`);
      }
      throw error;
    }
  }

  // H2, ADR-049 — "palier commercial gouverne l'accès aux fonctionnalités,
  // jamais dépendant de DGI" : contrairement à verifyDgi()/velocity_tier, cette
  // méthode ne lit JAMAIS dgiVerificationStatus. Aucun traitement de paiement
  // réel pour l'abonnement (aucune infrastructure de facturation récurrente
  // dans ce repo, même limite déjà acceptée pour H4/K4/K5).
  async upgradeCommercialTier(organizationId: string, tier: CommercialTier) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    await scoped.organization.findFirstOrThrow({ where: { id: organizationId } });
    return scoped.organization.update({
      where: { id: organizationId },
      data: { commercialTier: tier },
    });
  }

  // A4, ADR-025 — simple délégation, OrganizationSigningKeyService (@Global(),
  // certification.module.ts) porte toute la logique métier (idempotence,
  // jamais rétroactif).
  async revokeSigningKey(organizationId: string) {
    return this.signingKeyService.revoke(organizationId);
  }

  // E3, ADR-114 — rotation self-service owner/admin (DAT §Crypto "rotation 365j").
  // Délégation : OrganizationSigningKeyService porte toute la logique (retrait
  // atomique de l'active + provision d'une neuve, garde de course).
  async rotateSigningKey(organizationId: string) {
    return this.signingKeyService.rotate(organizationId);
  }

  async getSigningKeyStatus(organizationId: string) {
    return this.signingKeyService.getKeyStatus(organizationId);
  }

  // Security Audit 2026-08-23, finding #8 — self-service owner/admin, même posture
  // que revokeSigningKey() ci-dessus (une capacité compromise doit pouvoir être
  // coupée immédiatement, jamais un workflow d'approbation). updateMany+where
  // (jamais update inconditionnel) : une révocation concurrente ou une session déjà
  // expirée ne doit jamais réémettre un revokedAt "gagnant" trompeur.
  async revokeAssistedSession(organizationId: string, commercialAgentUserId: string) {
    const claimed = await organizationScopedClient(this.prisma, organizationId).assistedSession.updateMany({
      where: { organizationId, commercialAgentUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new NotFoundException(
        `Aucune AssistedSession active entre l'agent ${commercialAgentUserId} et l'organisation ${organizationId}`,
      );
    }
  }
}
