import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IS_PUBLIC_KEY } from "../auth/public.decorator";
import { WhatsAppInboundController } from "./whatsapp-inbound.controller";
import { WhatsAppWebhookAuthGuard } from "./whatsapp-webhook-auth.guard";

const GUARDS_METADATA_KEY = "__guards__";

function fakeResponse() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.type = vi.fn().mockReturnValue(res);
  return res;
}

describe("WhatsAppInboundController", () => {
  const originalEnv = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  beforeEach(() => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "jeton-de-verification";
  });

  afterEach(() => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = originalEnv;
  });

  describe("GET /webhooks/whatsapp — handshake Meta", () => {
    it("expose la route comme @Public()", () => {
      const reflector = new Reflector();
      const isPublic = reflector.get(IS_PUBLIC_KEY, WhatsAppInboundController.prototype.handshake);
      expect(isPublic).toBe(true);
    });

    it("jeton correct → 200, renvoie hub.challenge en texte brut avec Content-Type text/plain explicite (jamais le text/html par défaut d'Express — XSS réfléchi théorique)", () => {
      const inbound = { traiterMessage: vi.fn() };
      const controller = new WhatsAppInboundController(inbound as never);
      const res = fakeResponse();

      controller.handshake("jeton-de-verification", "1158201444", res);

      expect(res.type).toHaveBeenCalledWith("text/plain");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith("1158201444");
    });

    it("jeton incorrect → 403", () => {
      const inbound = { traiterMessage: vi.fn() };
      const controller = new WhatsAppInboundController(inbound as never);
      const res = fakeResponse();

      controller.handshake("jeton-invalide", "1158201444", res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).not.toHaveBeenCalledWith("1158201444");
    });

    it("jeton absent → 403", () => {
      const inbound = { traiterMessage: vi.fn() };
      const controller = new WhatsAppInboundController(inbound as never);
      const res = fakeResponse();

      controller.handshake(undefined, "1158201444", res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("échoue au démarrage si WHATSAPP_WEBHOOK_VERIFY_TOKEN n'est pas configuré", () => {
      delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      const inbound = { traiterMessage: vi.fn() };

      expect(() => new WhatsAppInboundController(inbound as never)).toThrow(/WHATSAPP_WEBHOOK_VERIFY_TOKEN/);
    });
  });

  describe("POST /webhooks/whatsapp — notification", () => {
    it("protège la route exclusivement par WhatsAppWebhookAuthGuard", () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA_KEY, WhatsAppInboundController.prototype.recevoir);
      expect(guards).toEqual([WhatsAppWebhookAuthGuard]);
    });

    it("répond TOUJOURS 200 à Meta (même pour un message ignoré côté métier — sans quoi Meta relivre en boucle)", () => {
      const HTTP_CODE_METADATA = "__httpCode__";
      const code = Reflect.getMetadata(HTTP_CODE_METADATA, WhatsAppInboundController.prototype.recevoir);
      expect(code).toBe(200);
    });

    it("expose la route comme @Public() — WhatsAppWebhookAuthGuard est le seul vrai garde", () => {
      const reflector = new Reflector();
      const isPublic = reflector.get(IS_PUBLIC_KEY, WhatsAppInboundController.prototype.recevoir);
      expect(isPublic).toBe(true);
    });

    it("délègue CHAQUE message de CHAQUE entry/changes au service, après le garde", async () => {
      const inbound = { traiterMessage: vi.fn().mockResolvedValue(undefined) };
      const controller = new WhatsAppInboundController(inbound as never);
      const message1 = { from: "224620000000", id: "wamid.1", type: "text", text: { body: "Facture 1" } };
      const message2 = { from: "224620000001", id: "wamid.2", type: "text", text: { body: "Facture 2" } };

      const resultat = await controller.recevoir({
        object: "whatsapp_business_account",
        entry: [
          { changes: [{ field: "messages", value: { messages: [message1] } }] },
          { changes: [{ field: "messages", value: { messages: [message2] } }] },
        ],
      } as never);

      expect(inbound.traiterMessage).toHaveBeenCalledTimes(2);
      expect(inbound.traiterMessage).toHaveBeenNthCalledWith(1, message1);
      expect(inbound.traiterMessage).toHaveBeenNthCalledWith(2, message2);
      expect(resultat).toEqual({ received: true });
    });

    it("répond quand même (accusé) pour un webhook SANS messages (uniquement des statuts) — jamais un crash", async () => {
      const inbound = { traiterMessage: vi.fn() };
      const controller = new WhatsAppInboundController(inbound as never);

      const resultat = await controller.recevoir({
        object: "whatsapp_business_account",
        entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.1", status: "read" }] } }] }],
      } as never);

      expect(inbound.traiterMessage).not.toHaveBeenCalled();
      expect(resultat).toEqual({ received: true });
    });
  });
});
