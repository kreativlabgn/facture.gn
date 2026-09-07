import { randomInt } from "node:crypto";
import { Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { PASSWORD_SERVICE } from "../auth/auth.tokens";
import type { PasswordService } from "../auth/password.service";
import { type Locale, resolveLocale, t } from "../i18n";
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

// Cross-Story Audit 2026-08-24, finding #2 — extrait de ClientPortalAuthService
// (F13) pour être réutilisable par AuthService.register() sans dupliquer la
// logique OTP : une réclamation de compte fantôme (User.passwordHash null créé
// par le portail client) doit prouver la possession du téléphone exactement de
// la même façon qu'une connexion au portail client, via le même mécanisme
// ClientPortalOtp — jamais un second système OTP inventé pour ce seul besoin.
// ClientPortalAuthService reste responsable de l'orchestration propre au
// portail (résolution/création de User, émission du token scope:"client_portal") ;
// ce service-ci ne connaît que le stockage/la vérification/la consommation de
// l'OTP lui-même.
// RLS (ADR-111 étape 1) — CE SERVICE RESTE ENTIÈREMENT NON SCOPÉ. `client_portal_otp`
// n'a ni colonne organization_id ni politique org_isolation : sa clé
// fonctionnelle est le msisdn, un OTP n'appartient à aucune organisation. Et
// resolveLocale() interroge délibérément les clients de TOUTES les
// organisations rattachées au numéro (voir son commentaire). Voir la carte
// complète en tête de ClientPortalService.
@Injectable()
export class ClientPortalOtpService {
  private readonly logger = new Logger(ClientPortalOtpService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PASSWORD_SERVICE) private readonly passwordService: PasswordService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: NotificationProvider,
  ) {}

  async request(msisdn: string): Promise<void> {
    const code = generateOtpCode();
    const codeHash = await this.passwordService.hash(code);

    // F13, revue post-fix #4 — sans ceci, un attaquant pouvait épuiser les 3
    // tentatives d'un OTP puis retomber sur un OTP plus ancien encore valide
    // pour ce même numéro (TTL 5 min chevauchant plusieurs `request()`),
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

    await this.smsProvider.send(msisdn, t("notification.clientPortalOtp", await this.resolveLocale(msisdn), { code }));
  }

  // Le portail client est cross-organisation (un même numéro peut être client de
  // plusieurs PME) : pas de langue d'organisation unique. On n'utilise une langue
  // que si toutes les organisations rattachées à ce numéro s'accordent ; sinon
  // `fr`. Jamais bloquant — un échec de lecture retombe sur `fr`.
  private async resolveLocale(msisdn: string): Promise<Locale> {
    try {
      const customers = await this.prisma.customer.findMany({
        where: { phone: msisdn },
        select: { organization: { select: { preferredLanguage: true } } },
        // Échantillon borné : au-delà de ~10 orgs pour un même numéro, la
        // probabilité d'un consensus de langue est nulle → `fr` de toute façon.
        take: 10,
      });
      const locales = new Set(customers.map((c) => resolveLocale(c.organization.preferredLanguage)));
      return locales.size === 1 ? [...locales][0] : "fr";
    } catch (error) {
      this.logger.debug(`Résolution de langue OTP échouée pour ${msisdn}, fallback fr : ${(error as Error).message}`);
      return "fr";
    }
  }

  // Valide ET consomme atomiquement le code fourni pour ce numéro. Ne renvoie
  // rien (void) en cas de succès — c'est à l'appelant (ClientPortalAuthService,
  // AuthService) de décider ce qui se passe ensuite (émission de token,
  // réclamation de compte, ...). Lève UnauthorizedException dans tous les cas
  // d'échec, avec le même message générique — jamais de distinction exploitable
  // entre "aucun OTP en attente" et "mauvais code".
  async verifyAndConsume(msisdn: string, code: string): Promise<void> {
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
    // plutôt que de laisser passer un second appelant pour le même code.
    const claimed = await this.prisma.clientPortalOtp.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }
  }
}
