import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { PASSWORD_SERVICE } from "../auth/auth.tokens";
import type { PasswordService } from "../auth/password.service";

const PIN_MAX_ATTEMPTS = 3;
const PIN_LOCKOUT_MS = 30 * 60_000;

export interface UssdIdentity {
  userId: string;
  organizationId?: string;
  hasPin: boolean;
}

export interface PinVerificationResult {
  success: boolean;
  locked: boolean;
}

// §3 Spec USSD — résolution d'identité (3.1 téléphone reconnu, 3.2 téléphone
// emprunté) et gestion du PIN (3.3, 3 essais puis blocage 30 min). Réutilise
// Argon2PasswordService (B3, mot de passe) — le risque réel d'un PIN à 4
// chiffres n'est pas la force du hash mais le brute-force ONLINE, mitigé par
// le compteur d'essais ci-dessous, pas par l'algorithme de hash lui-même.
@Injectable()
export class UssdAuthService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PASSWORD_SERVICE) private readonly passwordService: PasswordService,
  ) {}

  async resolveByPhone(phone: string): Promise<UssdIdentity | null> {
    const userPhone = await this.prisma.userPhone.findUnique({ where: { msisdn: phone } });
    if (!userPhone) {
      return null;
    }
    const user = await this.prisma.user.findUnique({ where: { id: userPhone.userId } });
    return { userId: userPhone.userId, hasPin: Boolean(user?.pinHash) };
  }

  // Le "code compte" (Organization.accountCode, ADR-047) identifie une
  // ORGANISATION, pas un individu — résolu vers son owner actif (personas MVP
  // à propriétaire unique). Un accès délégué ne partage jamais le PIN du
  // propriétaire (voir plan) : ce chemin ne sert jamais un collaborateur, qui a
  // son propre numéro reconnu (§3.1).
  async resolveByAccountCode(accountCode: string): Promise<UssdIdentity | null> {
    const organization = await this.prisma.organization.findUnique({ where: { accountCode } });
    if (!organization) {
      return null;
    }

    const owner = await this.prisma.organizationMember.findFirst({
      where: { organizationId: organization.id, role: "owner", revokedAt: null },
    });
    if (!owner) {
      return null;
    }

    const user = await this.prisma.user.findUnique({ where: { id: owner.userId } });
    return { userId: owner.userId, organizationId: organization.id, hasPin: Boolean(user?.pinHash) };
  }

  async createPin(userId: string, pin: string): Promise<void> {
    const pinHash = await this.passwordService.hash(pin);
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash, pinFailedAttempts: 0, pinLockedUntil: null },
    });
  }

  async verifyPin(userId: string, pin: string): Promise<PinVerificationResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    // Déjà bloqué : ne revérifie jamais le hash, même avec le bon PIN — sinon
    // le blocage serait contournable en connaissant simplement le bon PIN.
    if (user?.pinLockedUntil && user.pinLockedUntil > new Date()) {
      return { success: false, locked: true };
    }

    const valid = user?.pinHash ? await this.passwordService.verify(user.pinHash, pin) : false;

    if (valid) {
      await this.prisma.user.update({ where: { id: userId }, data: { pinFailedAttempts: 0 } });
      return { success: true, locked: false };
    }

    const attempts = (user?.pinFailedAttempts ?? 0) + 1;
    const lockedOut = attempts >= PIN_MAX_ATTEMPTS;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pinFailedAttempts: attempts,
        pinLockedUntil: lockedOut ? new Date(Date.now() + PIN_LOCKOUT_MS) : null,
      },
    });
    return { success: false, locked: false };
  }
}
