import { describe, expect, it, vi } from "vitest";
import { PaymentLinkNotificationService } from "./payment-link-notification.service";

function createFakeProvider(success = true) {
  return { send: vi.fn().mockResolvedValue({ success }) };
}

const CUSTOMER_BASE = { phone: "+224622334455" };
const PAYMENT_LINK_URL = "https://facture.gn/pay/inv-1";
const TOTAL_GNF = 100_000_00n; // 100 000 GNF en centimes

describe("PaymentLinkNotificationService", () => {
  it("envoie par SMS uniquement quand notificationChannel est sms", async () => {
    const sms = createFakeProvider();
    const whatsapp = createFakeProvider();
    const service = new PaymentLinkNotificationService(sms as any, whatsapp as any);

    await service.notify({ ...CUSTOMER_BASE, notificationChannel: "sms" }, PAYMENT_LINK_URL, TOTAL_GNF);

    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  it("envoie par WhatsApp uniquement quand notificationChannel est whatsapp", async () => {
    const sms = createFakeProvider();
    const whatsapp = createFakeProvider();
    const service = new PaymentLinkNotificationService(sms as any, whatsapp as any);

    await service.notify({ ...CUSTOMER_BASE, notificationChannel: "whatsapp" }, PAYMENT_LINK_URL, TOTAL_GNF);

    expect(whatsapp.send).toHaveBeenCalledTimes(1);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it("envoie par les deux canaux quand notificationChannel est both", async () => {
    const sms = createFakeProvider();
    const whatsapp = createFakeProvider();
    const service = new PaymentLinkNotificationService(sms as any, whatsapp as any);

    await service.notify({ ...CUSTOMER_BASE, notificationChannel: "both" }, PAYMENT_LINK_URL, TOTAL_GNF);

    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(whatsapp.send).toHaveBeenCalledTimes(1);
  });

  it("le message contient le lien de paiement", async () => {
    const sms = createFakeProvider();
    const whatsapp = createFakeProvider();
    const service = new PaymentLinkNotificationService(sms as any, whatsapp as any);

    await service.notify({ ...CUSTOMER_BASE, notificationChannel: "sms" }, PAYMENT_LINK_URL, TOTAL_GNF);

    expect(sms.send).toHaveBeenCalledWith(CUSTOMER_BASE.phone, expect.stringContaining(PAYMENT_LINK_URL));
  });

  it("ne lève jamais si le provider échoue — meilleur effort, jamais couplé à l'émission", async () => {
    const sms = { send: vi.fn().mockRejectedValue(new Error("réseau indisponible")) };
    const service = new PaymentLinkNotificationService(sms as any, createFakeProvider() as any);

    await expect(
      service.notify({ ...CUSTOMER_BASE, notificationChannel: "sms" }, PAYMENT_LINK_URL, TOTAL_GNF),
    ).resolves.toBeUndefined();
  });

  it("n'envoie rien si le client n'a pas de téléphone", async () => {
    const sms = createFakeProvider();
    const whatsapp = createFakeProvider();
    const service = new PaymentLinkNotificationService(sms as any, whatsapp as any);

    await service.notify({ phone: null, notificationChannel: "both" }, PAYMENT_LINK_URL, TOTAL_GNF);

    expect(sms.send).not.toHaveBeenCalled();
    expect(whatsapp.send).not.toHaveBeenCalled();
  });
});
