import { createHmac } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PartnerWebhookAuthGuard } from "./partner-webhook-auth.guard";

const SECRET = "a".repeat(64);
const RAW_BODY = Buffer.from(JSON.stringify({ name: "Boutique Kaloum SARL", nif: "GN99887766" }));

function signValid() {
  return createHmac("sha256", SECRET).update(RAW_BODY).digest("hex");
}

function buildContext(headers: Record<string, string | undefined>, rawBody: Buffer = RAW_BODY) {
  const request: any = { headers, rawBody };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe("PartnerWebhookAuthGuard", () => {
  const originalEnv = process.env.APIP_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.APIP_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.APIP_WEBHOOK_SECRET = originalEnv;
  });

  it("accepte une X-Partner-Key correcte et une X-Partner-Signature HMAC-SHA256 valide", () => {
    const guard = new PartnerWebhookAuthGuard();
    const context = buildContext({ "x-partner-key": SECRET, "x-partner-signature": signValid() });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("refuse une X-Partner-Key incorrecte", () => {
    const guard = new PartnerWebhookAuthGuard();
    const context = buildContext({ "x-partner-key": "clé-invalide", "x-partner-signature": signValid() });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("refuse une X-Partner-Signature invalide (corps altéré ou secret différent)", () => {
    const guard = new PartnerWebhookAuthGuard();
    const wrongSignature = createHmac("sha256", "autre-secret").update(RAW_BODY).digest("hex");
    const context = buildContext({ "x-partner-key": SECRET, "x-partner-signature": wrongSignature });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("refuse si X-Partner-Key est absente", () => {
    const guard = new PartnerWebhookAuthGuard();
    const context = buildContext({ "x-partner-signature": signValid() });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("refuse si X-Partner-Signature est absente", () => {
    const guard = new PartnerWebhookAuthGuard();
    const context = buildContext({ "x-partner-key": SECRET });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("échoue au démarrage si APIP_WEBHOOK_SECRET n'est pas configuré — même posture que InternalAuthGuard", () => {
    delete process.env.APIP_WEBHOOK_SECRET;

    expect(() => new PartnerWebhookAuthGuard()).toThrow(/APIP_WEBHOOK_SECRET/);
  });
});
