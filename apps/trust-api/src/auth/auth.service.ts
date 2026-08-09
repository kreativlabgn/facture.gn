import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { PASSWORD_SERVICE, AUTH_TOKEN_SERVICE } from "./auth.tokens";
import type { PasswordService } from "./password.service";
import type { AuthTokenService } from "./auth-token.service";
import type { RegisterDto } from "./dto/register.dto";
import type { LoginDto } from "./dto/login.dto";
import type { RequestRecoveryDto } from "./dto/request-recovery.dto";

// Réponse strictement identique que la correspondance msisdn+nif existe ou non —
// anti-énumération, même principe que login() (voir plan auth-rbac Risque 4).
const RECOVERY_REQUEST_GENERIC_MESSAGE =
  "Si les informations correspondent à un compte, une demande de récupération a été transmise à un administrateur de l'organisation.";

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PASSWORD_SERVICE) private readonly passwordService: PasswordService,
    @Inject(AUTH_TOKEN_SERVICE) private readonly tokenService: AuthTokenService,
  ) {}

  async register(dto: RegisterDto): Promise<{ userId: string }> {
    const existingPhone = await this.prisma.userPhone.findUnique({ where: { msisdn: dto.msisdn } });
    if (existingPhone) {
      throw new ConflictException(`Un compte existe déjà pour le numéro ${dto.msisdn}`);
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { name: dto.name, passwordHash } });
      await tx.userPhone.create({ data: { userId: created.id, msisdn: dto.msisdn, isPrimary: true } });
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
}
