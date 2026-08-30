import { describe, expect, it, vi } from "vitest";
import { PaymentReminderService } from "./payment-reminder.service";

function createFakeProvider(success = true) {
  return { send: vi.fn().mockResolvedValue({ success }) };
}

const CUSTOMER_BASE = { phone: "+224622334455" };
const INVOICE_NUMBER = "FG-2026-000001";
const AMOUNT_DUE_GNF = 150_000n;

describe("PaymentReminderService (I2)", () => {
  it("envoie par SMS uniquement quand notificationChannel est sms", async () => {
    const sms = createFakeProvider();
    const whatsapp = createFakeProvider();
    const service = new PaymentReminderService(sms as any, whatsapp as any);

    await service.send({ ...CUSTOMER_BASE, notificationChannel: "sms" }, INVOICE_NUMBER, AMOUNT_DUE_GNF);

    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  it("envoie par les deux canaux quand notificationChannel est both", async () => {
    const sms = createFakeProvider();
    const whatsapp = createFakeProvider();
    const service = new PaymentReminderService(sms as any, whatsapp as any);

    await service.send({ ...CUSTOMER_BASE, notificationChannel: "both" }, INVOICE_NUMBER, AMOUNT_DUE_GNF);

    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(whatsapp.send).toHaveBeenCalledTimes(1);
  });

  it("le message contient le numéro de facture et le montant dû", async () => {
    const sms = createFakeProvider();
    const whatsapp = createFakeProvider();
    const service = new PaymentReminderService(sms as any, whatsapp as any);

    await service.send({ ...CUSTOMER_BASE, notificationChannel: "sms" }, INVOICE_NUMBER, AMOUNT_DUE_GNF);

    expect(sms.send).toHaveBeenCalledWith(
      CUSTOMER_BASE.phone,
      expect.stringContaining(INVOICE_NUMBER),
    );
  });

  const EXPECTED_FR = `Rappel : votre facture ${INVOICE_NUMBER} de ${AMOUNT_DUE_GNF.toLocaleString("fr-FR")} GNF reste impayée. Merci de régulariser rapidement.`;

  it("rend le message FR exact (garde de non-régression de wording)", async () => {
    const sms = createFakeProvider();
    const service = new PaymentReminderService(sms as any, createFakeProvider() as any);

    await service.send({ ...CUSTOMER_BASE, notificationChannel: "sms" }, INVOICE_NUMBER, AMOUNT_DUE_GNF, "fr");

    expect(sms.send).toHaveBeenCalledWith(CUSTOMER_BASE.phone, EXPECTED_FR);
  });

  it("retombe sur le message FR quand pular n'est pas encore traduit", async () => {
    const sms = createFakeProvider();
    const service = new PaymentReminderService(sms as any, createFakeProvider() as any);

    await service.send({ ...CUSTOMER_BASE, notificationChannel: "sms" }, INVOICE_NUMBER, AMOUNT_DUE_GNF, "pular");

    expect(sms.send).toHaveBeenCalledWith(CUSTOMER_BASE.phone, EXPECTED_FR);
  });

  it("ne lève jamais si le provider échoue — meilleur effort", async () => {
    const sms = { send: vi.fn().mockRejectedValue(new Error("réseau indisponible")) };
    const service = new PaymentReminderService(sms as any, createFakeProvider() as any);

    await expect(
      service.send({ ...CUSTOMER_BASE, notificationChannel: "sms" }, INVOICE_NUMBER, AMOUNT_DUE_GNF),
    ).resolves.toBeUndefined();
  });
});
