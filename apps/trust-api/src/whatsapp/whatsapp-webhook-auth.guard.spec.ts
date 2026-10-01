import { createHmac } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WhatsAppWebhookAuthGuard } from "./whatsapp-webhook-auth.guard";

// Premier filet de la revue de sécurité répétée exigée par CONTRIBUTING.md
// pour toute nouvelle frontière de confiance — exhaustif, pas juste le chemin
// heureux (comparaison à temps constant, secret manquant au démarrage, corps
// altéré, signature mal formée, préfixe absent).

const SECRET = "a".repeat(64);
const RAW_BODY = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));

function signValid(secret: string = SECRET, body: Buffer = RAW_BODY) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function buildContext(headers: Record<string, string | undefined>, rawBody: Buffer | undefined = RAW_BODY) {
  const request: any = { headers, rawBody };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe("WhatsAppWebhookAuthGuard", () => {
  const originalEnv = process.env.WHATSAPP_APP_SECRET;

  beforeEach(() => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.WHATSAPP_APP_SECRET = originalEnv;
  });

  it("accepte une X-Hub-Signature-256 HMAC-SHA256 valide, format sha256=<hex>", () => {
    const guard = new WhatsAppWebhookAuthGuard();
    const context = buildContext({ "x-hub-signature-256": signValid() });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("refuse une signature absente", () => {
    const guard = new WhatsAppWebhookAuthGuard();
    const context = buildContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("refuse une signature vide", () => {
    const guard = new WhatsAppWebhookAuthGuard();
    const context = buildContext({ "x-hub-signature-256": "" });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("refuse une signature mal formée (sans le préfixe sha256=)", () => {
    const guard = new WhatsAppWebhookAuthGuard();
    const context = buildContext({
      "x-hub-signature-256": createHmac("sha256", SECRET).update(RAW_BODY).digest("hex"),
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("refuse une signature incorrecte (secret différent)", () => {
    const guard = new WhatsAppWebhookAuthGuard();
    const context = buildContext({ "x-hub-signature-256": signValid("autre-secret-tout-a-fait-different") });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("refuse un corps altéré APRÈS signature (rawBody ne correspond plus à la signature fournie)", () => {
    const guard = new WhatsAppWebhookAuthGuard();
    const signatureDuCorpsOriginal = signValid();
    const corpsAltere = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [] }] }));
    const context = buildContext({ "x-hub-signature-256": signatureDuCorpsOriginal }, corpsAltere);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("refuse quand request.rawBody est absent (rawBody:true non actif pour cette route)", () => {
    const guard = new WhatsAppWebhookAuthGuard();
    const request: any = { headers: { "x-hub-signature-256": signValid() } }; // pas de rawBody du tout
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("refuse une signature portant un préfixe correct mais une longueur différente (jamais un throw RangeError non attrapé)", () => {
    const guard = new WhatsAppWebhookAuthGuard();
    const context = buildContext({ "x-hub-signature-256": "sha256=abcd" });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("refuse un en-tête non-string (tableau de valeurs dupliquées)", () => {
    const guard = new WhatsAppWebhookAuthGuard();
    const context = buildContext({ "x-hub-signature-256": [signValid(), signValid()] as unknown as string });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("échoue au démarrage si WHATSAPP_APP_SECRET n'est pas configuré — même posture que PartnerWebhookAuthGuard/DgiVerificationAuthGuard", () => {
    delete process.env.WHATSAPP_APP_SECRET;

    expect(() => new WhatsAppWebhookAuthGuard()).toThrow(/WHATSAPP_APP_SECRET/);
  });
});
