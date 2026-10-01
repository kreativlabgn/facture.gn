import { createHmac, timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { WHATSAPP_SIGNATURE_HEADER } from "./whatsapp.constants";

// Clarification 6 du plan 2026-09-16 (OCR multicanal) — garde de signature du
// webhook Meta Cloud API. Mécanique HMAC directement reprise de
// PartnerWebhookAuthGuard (apps/trust-api/src/partners/) : c'est un
// algorithme générique, pas une décision métier. TOUT LE RESTE (résolution
// d'expéditeur, opt-in, anti-abus) est neuf — voir whatsapp-inbound.service.ts.
//
// En-tête et format PROPRES à Meta, distincts de PartnerWebhookAuthGuard :
// `X-Hub-Signature-256: sha256=<hex>` — un SEUL en-tête, pas de clé séparée
// (Meta ne fournit pas d'équivalent à X-Partner-Key).
//
// request.rawBody (Buffer) exige NestFactory.create(AppModule, { rawBody: true })
// — DÉJÀ activé globalement dans main.ts pour PartnerWebhookAuthGuard, AUCUN
// changement à main.ts nécessaire ici. Sans ce flag, un corps reconstruit par
// JSON.stringify(request.body) ne serait PAS bit-à-bit identique au corps
// réellement signé par Meta (ordre des clés, espacement) et invaliderait
// silencieusement des signatures pourtant légitimes.
//
// PREMIER FILET DE LA REVUE DE SÉCURITÉ RÉPÉTÉE (CONTRIBUTING.md) — comparaison
// À TEMPS CONSTANT (timingSafeEqual), jamais ===, sur la chaîne COMPLÈTE
// (préfixe `sha256=` inclus) : un attaquant qui devinerait le HMAC octet par
// octet via un oracle de timing pourrait forger une requête WhatsApp
// arbitraire, résolue ensuite vers UNE organisation réelle par
// whatsapp-inbound.service.ts — la même classe de risque qu'une clé API
// devinable.
@Injectable()
export class WhatsAppWebhookAuthGuard implements CanActivate {
  private readonly appSecret: string;

  constructor() {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) {
      throw new Error("WHATSAPP_APP_SECRET manquant — voir README pour générer le secret d'application Meta");
    }
    this.appSecret = secret;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signature = request.headers?.[WHATSAPP_SIGNATURE_HEADER];

    if (!this.isValidSignature(signature, request.rawBody)) {
      throw new UnauthorizedException("Signature webhook WhatsApp invalide");
    }
    return true;
  }

  private isValidSignature(provided: unknown, rawBody: Buffer | undefined): boolean {
    if (typeof provided !== "string" || provided.length === 0 || !rawBody) {
      return false;
    }
    const expected = `sha256=${createHmac("sha256", this.appSecret).update(rawBody).digest("hex")}`;
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    // Longueurs égales AVANT timingSafeEqual : des tailles différentes y
    // lèveraient (RangeError) — un throw non attrapé ici serait un 500 brut
    // là où l'appelant attend un 401 explicite. Comparer d'abord la longueur
    // ne fuit rien de plus qu'un déchiffrement HMAC ne fuit déjà pas : la
    // longueur attendue (71 caractères, "sha256=" + 64 hex) est publique.
    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(providedBuf, expectedBuf);
  }
}
