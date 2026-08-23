import { describe, expect, it, vi } from "vitest";
import { resolveNotificationProviders } from "./notification-dispatch";

function fakeProvider(name: string) {
  return { name, send: vi.fn() };
}

describe("resolveNotificationProviders (I2, extrait de PaymentLinkNotificationService)", () => {
  it("retourne uniquement le provider SMS pour le canal sms", () => {
    const sms = fakeProvider("sms");
    const whatsapp = fakeProvider("whatsapp");

    const result = resolveNotificationProviders("sms", sms as any, whatsapp as any);

    expect(result).toEqual([sms]);
  });

  it("retourne uniquement le provider WhatsApp pour le canal whatsapp", () => {
    const sms = fakeProvider("sms");
    const whatsapp = fakeProvider("whatsapp");

    const result = resolveNotificationProviders("whatsapp", sms as any, whatsapp as any);

    expect(result).toEqual([whatsapp]);
  });

  it("retourne les deux providers pour le canal both", () => {
    const sms = fakeProvider("sms");
    const whatsapp = fakeProvider("whatsapp");

    const result = resolveNotificationProviders("both", sms as any, whatsapp as any);

    expect(result).toEqual([sms, whatsapp]);
  });
});
