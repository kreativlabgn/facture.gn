import { randomInt } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { PASSWORD_SERVICE, AUTH_TOKEN_SERVICE } from "../auth/auth.tokens";
import type { PasswordService } from "../auth/password.service";
import type { AuthTokenService } from "../auth/auth-token.service";
import type { NotificationProvider } from "../notifications/notification-provider.interface";
import { SMS_PROVIDER } from "../notifications/notifications.tokens";

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 3;

// Message générique, jamais distinct entre "code inconnu"/"expiré"/"déjà consommé"/
// "mauvais code" — anti-énumération, même principe que AuthService.login().
const INVALID_OTP_MESSAGE = "Code invalide ou expiré";

function generateOtpCode(): string {
  // F13, ADR-108 — 4 chiffres, CSPRNG (jamais Math.random()). Zéros initiaux
  // significatifs : padStart, pas de conversion numérique après génération.
  return randomInt(0, 10_000).toString().padStart(4, "0");
}

// F13, ADR-096/ADR-108 — auto-inscription par OTP SMS, canal PWA du portail
// client. Aucune invitation préalable requise : un numéro totalement inconnu du
// repo peut demander/vérifier un OTP, ce qui résout ou crée son identité User
// (voir resolveOrCreateUser). Le canal *620# reste sur UssdAuthService (PIN
// direct, ADR-108) — non concerné par ce service.
@Injectable()
export class ClientPortalAuthService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PASSWORD_SERVICE) private readonly passwordService: PasswordService,
    @Inject(AUTH_TOKEN_SERVICE) private readonly tokenService: AuthTokenService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: NotificationProvider,
  ) {}

  async requestOtp(msisdn: string): Promise<{ message: string }> {
    const code = generateOtpCode();
    const codeHash = await this.passwordService.hash(code);

    // F13, revue post-fix #4 — sans ceci, un attaquant pouvait épuiser les 3
    // tentatives d'un OTP puis retomber sur un OTP plus ancien encore valide
    // pour ce même numéro (TTL 5 min chevauchant plusieurs `requestOtp()`),
    // contournant l'invariant "3 tentatives max avant qu'un nouveau code soit
    // nécessaire". Un seul OTP valide à la fois par numéro : toute demande
    // invalide immédiatement les précédentes encore non consommées.
    await this.prisma.clientPortalOtp.updateMany({
      where: { msisdn, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await this.prisma.clientPortalOtp.create({
      data: { msisdn, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });

    await this.smsProvider.send(msisdn, `Votre code facture.gn : ${code} (valable 5 minutes).`);

    // Toujours le même message, que le numéro soit déjà connu ou non — la
    // résolution d'identité n'a lieu qu'à la vérification, jamais ici.
    return { message: "Un code de vérification a été envoyé par SMS." };
  }

  async verifyOtp(msisdn: string, code: string): Promise<{ accessToken: string }> {
    const otp = await this.prisma.clientPortalOtp.findFirst({
      where: { msisdn, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) {
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }

    const valid = await this.passwordService.verify(otp.codeHash, code);
    if (!valid) {
      const attempts = otp.attempts + 1;
      const exhausted = attempts >= OTP_MAX_ATTEMPTS;
      await this.prisma.clientPortalOtp.update({
        where: { id: otp.id },
        // exhausted : brûle l'OTP même si le code correct n'a jamais été tenté —
        // même philosophie que PIN_MAX_ATTEMPTS/PIN_LOCKOUT_MS (UssdAuthService),
        // 3 essais puis il faut redemander un code plutôt qu'un blocage temporisé
        // (TTL déjà court, 5 min).
        data: { attempts, consumedAt: exhausted ? new Date() : null },
      });
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }

    // Consommation atomique — anti-rejeu sous course concurrente (même pattern
    // que les autres transitions à garde de concurrence de ce repo, Security/
    // Quality Audit 2026-08-23) : si une autre requête a déjà consommé cet OTP
    // entre la lecture ci-dessus et cette écriture, count===0 et on rejette
    // plutôt que d'émettre un second token pour le même code.
    const claimed = await this.prisma.clientPortalOtp.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }

    const userId = await this.resolveOrCreateUser(msisdn);
    const accessToken = await this.tokenService.sign({ sub: userId });
    return { accessToken };
  }

  // ADR-096 : un numéro déjà connu (ex. collaborateur d'une organisation
  // ailleurs) réutilise son User existant tel quel — jamais une seconde
  // identité pour le même msisdn. Un numéro totalement inconnu déclenche
  // l'auto-inscription : User sans passwordHash/pinHash (jamais utilisable pour
  // /auth/login ni *620#, seule la session client_portal issue de cet OTP y
  // donne accès) + UserPhone déjà vérifié.
  private async resolveOrCreateUser(msisdn: string): Promise<string> {
    const existingPhone = await this.prisma.userPhone.findUnique({ where: { msisdn } });
    if (existingPhone) {
      if (!existingPhone.verifiedAt) {
        await this.prisma.userPhone.update({
          where: { id: existingPhone.id },
          data: { verifiedAt: new Date() },
        });
      }
      return existingPhone.userId;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // Aucune collecte de nom pendant l'auto-inscription OTP — le msisdn sert
      // de nom par défaut, faute d'un flux "profil" dans le périmètre de F13.
      const user = await tx.user.create({ data: { name: msisdn } });
      await tx.userPhone.create({
        data: { userId: user.id, msisdn, isPrimary: true, verifiedAt: new Date() },
      });
      return user;
    });

    return created.id;
  }
}
