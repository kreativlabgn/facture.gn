import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { PASSWORD_SERVICE, AUTH_TOKEN_SERVICE } from "./auth.tokens";
import type { PasswordService } from "./password.service";
import type { AuthTokenService } from "./auth-token.service";
import { TokenRevocationService } from "./token-revocation.service";
import { PendingMemberInviteService } from "../pending-member-invites/pending-member-invite.service";
import { ClientPortalOtpService } from "../client-portal/client-portal-otp.service";
import type { RegisterDto } from "./dto/register.dto";
import type { LoginDto } from "./dto/login.dto";
import type { RequestRecoveryDto } from "./dto/request-recovery.dto";

// Réponse strictement identique que la correspondance msisdn+nif existe ou non —
// anti-énumération, même principe que login() (voir plan auth-rbac Risque 4).
const RECOVERY_REQUEST_GENERIC_MESSAGE =
  "Si les informations correspondent à un compte, une demande de récupération a été transmise à un administrateur de l'organisation.";

// G2 (backlog : "geler temporairement les plafonds après un reset PIN", sans
// détail ni ADR — réinterprété faute de PIN/plafond dans ce repo, voir plan
// freeze-after-account-recovery) — 24h choisi comme fenêtre MVP raisonnable,
// aucun signal backlog pour une valeur précise.
const RECOVERY_FREEZE_WINDOW_MS = 24 * 3600_000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PASSWORD_SERVICE) private readonly passwordService: PasswordService,
    @Inject(AUTH_TOKEN_SERVICE) private readonly tokenService: AuthTokenService,
    private readonly tokenRevocation: TokenRevocationService,
    private readonly pendingMemberInvite: PendingMemberInviteService,
    private readonly clientPortalOtp: ClientPortalOtpService,
  ) {}

  async register(dto: RegisterDto): Promise<{ userId: string }> {
    // Cross-Story Audit 2026-08-24, finding #2 HAUTE — include: {user: true}
    // ajouté pour distinguer un VRAI compte existant (passwordHash posé, via ce
    // même register() ou un chemin assisté) d'un compte "fantôme" créé par
    // ClientPortalAuthService.verifyOtp() (F13, resolveOrCreateUser()) : un
    // numéro invité via F10 qui passe d'abord par l'OTP portail client se
    // retrouve avec un User(passwordHash: null) déjà vérifié pour ce msisdn.
    // Sans cette distinction, register() rejetait INCONDITIONNELLEMENT ce
    // fantôme avec ConflictException — la personne ne pouvait alors plus jamais
    // définir de mot de passe sur ce compte, ni résoudre l'invitation F10 qui
    // lui était pourtant destinée (register() est le seul chemin qui appelle
    // resolveForNewUser()).
    const existingPhone = await this.prisma.userPhone.findUnique({
      where: { msisdn: dto.msisdn },
      include: { user: true },
    });

    if (existingPhone?.user.passwordHash) {
      throw new ConflictException(`Un compte existe déjà pour le numéro ${dto.msisdn}`);
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    if (existingPhone) {
      // Cross-Story Audit 2026-08-24, finding #2 CRITIQUE — sans preuve de
      // possession du téléphone, N'IMPORTE QUI connaissant un numéro associé à
      // un compte fantôme (créé par le portail client OTP) pouvait poser un mot
      // de passe de son choix dessus et déclencher aussitôt
      // PendingMemberInvite.resolveForNewUser() dans la même transaction —
      // potentiellement un rôle admin/organisation donné à l'attaquant. Choix
      // retenu (documenté ici, pas un second mécanisme inventé) : réutiliser
      // TEL QUEL le flux OTP déjà construit pour F13 (ClientPortalOtp via
      // ClientPortalOtpService, le même service que ClientPortalAuthService.
      // verifyOtp()) — le client doit avoir demandé un OTP sur ce numéro
      // (POST /client-portal/otp/request) puis fournir le code reçu en plus de
      // son mot de passe choisi, plutôt qu'exposer un endpoint de réclamation
      // séparé qui aurait dupliqué toute la logique de resolveForNewUser()/
      // transaction déjà en place ici. otpCode absent ou invalide → rejeté
      // AVANT toute écriture, avec le même message générique que verifyOtp()
      // (anti-énumération, cohérent avec le reste de ce fichier).
      if (!dto.otpCode) {
        throw new UnauthorizedException("Code invalide ou expiré");
      }
      await this.clientPortalOtp.verifyAndConsume(dto.msisdn, dto.otpCode);

      // Réclamation d'un compte fantôme F13 : le User et son UserPhone (déjà
      // vérifié par l'OTP) existent déjà, on ne fait que poser le mot de passe
      // et remplacer le nom par défaut (le msisdn, voir
      // ClientPortalAuthService.resolveOrCreateUser()) par le vrai nom fourni
      // ici. Même transaction que le chemin "nouveau compte" ci-dessous pour
      // résoudre PendingMemberInvite : jamais un mot de passe posé sans que
      // l'invitation qui a motivé cette inscription ne soit résolue.
      //
      // Cross-Story Audit 2026-08-24, finding #2 (course résiduelle) —
      // updateMany(where:{id, passwordHash: null}) plutôt qu'update(where:{id})
      // inconditionnel : même idiome que pending-member-invite.service.ts.
      // Sous deux réclamations concurrentes du même compte fantôme (chacune
      // avec un OTP valide — improbable mais possible si l'attaquant et la
      // victime demandent chacun un OTP recevable au même moment), seule celle
      // dont l'updateMany voit encore passwordHash:null peut committer ; l'autre
      // reçoit count===0 et est rejetée proprement plutôt que d'écraser
      // silencieusement le mot de passe déjà posé par la première.
      const user = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.user.updateMany({
          where: { id: existingPhone.userId, passwordHash: null },
          data: { name: dto.name, passwordHash },
        });
        if (claimed.count === 0) {
          throw new ConflictException(`Ce compte a déjà été réclamé pour le numéro ${dto.msisdn}`);
        }
        await this.pendingMemberInvite.resolveForNewUser(tx, existingPhone.userId, dto.msisdn);
        return { id: existingPhone.userId };
      });

      return { userId: user.id };
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { name: dto.name, passwordHash } });
      await tx.userPhone.create({ data: { userId: created.id, msisdn: dto.msisdn, isPrimary: true } });
      // F10 — résout dans la même transaction toute PendingMemberInvite en
      // attente pour ce numéro (organisation ou cabinet, éventuellement les
      // deux) : jamais un état partiel (user créé sans son invitation résolue)
      // qui pourrait survivre à un rollback.
      await this.pendingMemberInvite.resolveForNewUser(tx, created.id, dto.msisdn);
      return created;
    });

    return { userId: user.id };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const phone = await this.prisma.userPhone.findUnique({
      where: { msisdn: dto.msisdn },
      include: { user: true },
    });

    // Même message quelle que soit la cause (msisdn inconnu ou mot de passe erroné) —
    // anti-énumération d'utilisateurs, voir plan auth-rbac Risque 4.
    const valid = phone?.user.passwordHash
      ? await this.passwordService.verify(phone.user.passwordHash, dto.password)
      : false;

    if (!phone || !valid) {
      throw new UnauthorizedException("Identifiants invalides");
    }

    const accessToken = await this.tokenService.sign({ sub: phone.user.id });
    return { accessToken };
  }

  // ADR-042, B3 — "backup admin obligatoire" est un nudge, jamais un blocage
  // (cohérent avec B1/B4) : aucune désignation explicite, n'importe quel membre
  // owner/admin non révoqué de l'organisation peut résoudre la demande.
  //
  // Cible restreinte à role="owner" (revue sécurité) : le backlog B3 porte
  // explicitement sur "récupérer l'accès à un compte owner", pas n'importe quel
  // membre. Sans cette restriction, un admin déjà légitimement dans l'organisation
  // pouvait initier ET approuver seul une récupération pour un AUTRE admin/cashier
  // (voire l'owner) sans son consentement — mouvement latéral interne, la victime
  // n'étant jamais impliquée (aucun canal de notification n'existe pour l'alerter).
  async requestRecovery(dto: RequestRecoveryDto): Promise<{ message: string }> {
    const phone = await this.prisma.userPhone.findUnique({ where: { msisdn: dto.msisdn } });
    const organization = await this.prisma.organization.findUnique({ where: { nif: dto.organizationNif } });

    if (phone && organization) {
      const membership = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: organization.id, userId: phone.userId } },
      });

      if (membership && !membership.revokedAt && membership.role === "owner") {
        const existingPending = await this.prisma.accountRecoveryRequest.findFirst({
          where: { userId: phone.userId, organizationId: organization.id, status: "pending" },
        });
        if (!existingPending) {
          await this.prisma.accountRecoveryRequest.create({
            data: { userId: phone.userId, organizationId: organization.id },
          });
        }
      }
    }

    // Renvoyé dans TOUS les cas, identique — jamais de fuite sur la correspondance.
    return { message: RECOVERY_REQUEST_GENERIC_MESSAGE };
  }

  async resolveRecovery(
    requestId: string,
    approverId: string,
    decision: "approved" | "rejected",
  ): Promise<{ temporaryPassword: string | null }> {
    const request = await this.prisma.accountRecoveryRequest.findUniqueOrThrow({ where: { id: requestId } });

    if (request.userId === approverId) {
      throw new ConflictException("Vous ne pouvez pas résoudre votre propre demande de récupération");
    }

    const approverMembership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: request.organizationId, userId: approverId } },
    });
    if (
      !approverMembership ||
      approverMembership.revokedAt ||
      !["owner", "admin"].includes(approverMembership.role)
    ) {
      throw new ForbiddenException(
        "Seul un owner ou admin de l'organisation peut résoudre cette demande de récupération",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Même garde atomique que convertToInvoice()/forfeitDeposit() (C15/C5) : sous
      // deux résolutions concurrentes, seule la transaction qui voit encore
      // status="pending" au moment de l'écriture peut committer.
      const claimed = await tx.accountRecoveryRequest.updateMany({
        where: { id: requestId, status: "pending" },
        data: { status: decision, resolvedAt: new Date(), resolvedByUserId: approverId },
      });
      if (claimed.count === 0) {
        throw new ConflictException(`Demande ${requestId} a déjà été résolue`);
      }

      if (decision === "rejected") {
        return { temporaryPassword: null };
      }

      const temporaryPassword = this.passwordService.generateTemporaryPassword();
      const passwordHash = await this.passwordService.hash(temporaryPassword);
      await tx.user.update({ where: { id: request.userId }, data: { passwordHash } });

      // Fenêtre de vigilance post-récupération (G2, réinterprété) — le compte
      // vient de changer de mot de passe, moment de plus haute suspicion.
      await tx.organization.update({
        where: { id: request.organizationId },
        data: { paymentsFrozenUntil: new Date(Date.now() + RECOVERY_FREEZE_WINDOW_MS) },
      });

      return { temporaryPassword };
    });
  }

  // ADR-087, B6 — login() résout déjà par n'importe quelle ligne UserPhone (aucune
  // modification nécessaire là-bas) : il ne manquait que ce point d'écriture. Catch
  // sur la contrainte unique DB directement (pas un findUnique préalable, qui
  // laisserait une fenêtre de course entre la lecture et l'écriture).
  //
  // Re-confirmation du mot de passe (revue sécurité) : un JWT valide prouve une
  // session active, pas une intention fraîche pour une action qui modifie
  // durablement les moyens d'accès au compte — un JWT volé sans le mot de passe ne
  // doit jamais suffire à planter un numéro persistant sur le compte de la victime.
  async addPhone(userId: string, msisdn: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = user.passwordHash ? await this.passwordService.verify(user.passwordHash, password) : false;
    if (!valid) {
      throw new UnauthorizedException("Mot de passe incorrect");
    }

    try {
      return await this.prisma.userPhone.create({ data: { userId, msisdn, isPrimary: false } });
    } catch (error) {
      if (isUniqueConstraintViolation(error, "msisdn")) {
        throw new ConflictException(`Un compte existe déjà pour le numéro ${msisdn}`);
      }
      throw error;
    }
  }

  // Security Audit 2026-08-23, finding #14 — révoque UNIQUEMENT le token présenté
  // par cette requête (jti/exp déjà vérifiés et peuplés par JwtAuthGuard, jamais
  // recalculés ici) : pas de "déconnexion de tous les appareils", ce n'est pas
  // le périmètre de cette capacité minimale. exp en secondes epoch (claim JWT
  // standard) → converti en Date pour RevokedToken.expiresAt.
  async logout(jti: string, exp: number): Promise<void> {
    await this.tokenRevocation.revoke(jti, new Date(exp * 1000));
  }

  // ADR-045, B5, ADR-107 — élève un utilisateur déjà enregistré (Chemin A) au
  // statut Agent commercial terrain plateforme (sans rapport avec
  // OrganizationRole.field_agent). Aucun check explicite d'existence : Prisma lève
  // déjà son erreur si userId est inconnu, cohérent avec findUniqueOrThrow ailleurs.
  async grantCommercialAgentStatus(userId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { isCommercialAgent: true } });
  }
}
