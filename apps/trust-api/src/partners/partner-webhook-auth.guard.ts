import { createHmac, timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

const PARTNER_KEY_HEADER = "x-partner-key";
const PARTNER_SIGNATURE_HEADER = "x-partner-signature";

// ADR-082 — "API key + HMAC-SHA256". Mirroir de InternalAuthGuard (même posture
// fail-fast, même comparaison à temps constant) pour la clé, ÉTENDU avec une
// vérification HMAC-SHA256 du corps brut — APIP_WEBHOOK_SECRET sert aux deux
// usages (clé attendue ET secret HMAC), cohérent avec le MVP mono-partenaire
// (APIP seul a une intégration technique réelle, ADR-078). request.rawBody
// (Buffer) exige NestFactory.create(AppModule, { rawBody: true }) dans main.ts —
// sans ce flag, JSON.stringify(request.body) reconstruit ne serait PAS
// bit-à-bit identique au corps réellement signé par APIP (ordre des clés,
// espacement) et invaliderait silencieusement des signatures pourtant légitimes.
@Injectable()
export class PartnerWebhookAuthGuard implements CanActivate {
  private readonly expectedSecret: string;

  constructor() {
    const secret = process.env.APIP_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error("APIP_WEBHOOK_SECRET manquant — voir README pour générer le secret webhook partenaire");
    }
    this.expectedSecret = secret;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const providedKey = request.headers?.[PARTNER_KEY_HEADER];
    const providedSignature = request.headers?.[PARTNER_SIGNATURE_HEADER];

    if (!this.isValidSecret(providedKey) || !this.isValidSignature(providedSignature, request.rawBody)) {
      throw new UnauthorizedException("Clé ou signature partenaire invalide");
    }
    return true;
  }

  private isValidSecret(provided: unknown): boolean {
    if (typeof provided !== "string") {
      return false;
    }
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(this.expectedSecret);
    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(providedBuf, expectedBuf);
  }

  private isValidSignature(provided: unknown, rawBody: Buffer | undefined): boolean {
    if (typeof provided !== "string" || !rawBody) {
      return false;
    }
    const expectedSignature = createHmac("sha256", this.expectedSecret).update(rawBody).digest("hex");
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expectedSignature);
    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(providedBuf, expectedBuf);
  }
}
