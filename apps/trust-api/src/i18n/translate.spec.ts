import { describe, expect, it, vi } from "vitest";

import { t } from "./translate";

describe("t (traduction)", () => {
  it("rend la chaîne FR avec les paramètres interpolés", () => {
    expect(t("notification.paymentLinkReady", "fr", { amountGnf: "1 250 000", url: "https://facture.gn/pay/x" })).toBe(
      "Votre facture de 1 250 000 GNF est prête : https://facture.gn/pay/x",
    );
    expect(t("notification.paymentReminder", "fr", { invoiceNumber: "F-2026-0007", amountGnf: "80 000" })).toBe(
      "Rappel : votre facture F-2026-0007 de 80 000 GNF reste impayée. Merci de régulariser rapidement.",
    );
    expect(t("notification.clientPortalOtp", "fr", { code: "482913" })).toBe(
      "Votre code facture.gn : 482913 (valable 5 minutes).",
    );
    expect(t("notification.pinChanged", "fr", {})).toBe(
      "Votre PIN facture.gn a été changé. Si ce n'est pas vous, contactez le support.",
    );
    expect(t("notification.memberInvite", "fr", { inviterName: "Aïssatou Barry" })).toBe(
      "Aïssatou Barry vous invite à rejoindre facture.gn. Inscrivez-vous sur facture.gn pour accéder à votre espace.",
    );
  });

  it("retombe sur la chaîne FR quand la clé n'est pas encore traduite en pular (stub vide)", () => {
    expect(t("notification.pinChanged", "pular", {})).toBe(
      "Votre PIN facture.gn a été changé. Si ce n'est pas vous, contactez le support.",
    );
  });
});

describe("t (traduction) — pular présent", () => {
  it("rend la chaîne pular quand elle existe dans le catalogue", async () => {
    vi.resetModules();
    vi.doMock("./messages.pular", () => ({
      pular: { "notification.pinChanged": () => "Pin facture.gn maa waylaama." },
    }));
    const { t: tReloaded } = await import("./translate");

    expect(tReloaded("notification.pinChanged", "pular", {})).toBe("Pin facture.gn maa waylaama.");

    vi.doUnmock("./messages.pular");
    vi.resetModules();
  });
});
