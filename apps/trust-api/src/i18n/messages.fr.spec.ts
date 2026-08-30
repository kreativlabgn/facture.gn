import { describe, expect, it } from "vitest";

import { fr } from "./messages.fr";

// Garde anti-régression de wording : les chaînes FR doivent rester IDENTIQUES à
// celles d'origine (avant le lot i18n). Toute modification volontaire doit
// mettre à jour ce test en connaissance de cause.
describe("messages.fr — wording figé", () => {
  it("lien de paiement prêt", () => {
    expect(fr["notification.paymentLinkReady"]({ amountGnf: "100 000", url: "https://facture.gn/pay/inv-1" })).toBe(
      "Votre facture de 100 000 GNF est prête : https://facture.gn/pay/inv-1",
    );
  });

  it("rappel de facture impayée", () => {
    expect(fr["notification.paymentReminder"]({ invoiceNumber: "F-2026-0007", amountGnf: "80 000" })).toBe(
      "Rappel : votre facture F-2026-0007 de 80 000 GNF reste impayée. Merci de régulariser rapidement.",
    );
  });

  it("code OTP portail client", () => {
    expect(fr["notification.clientPortalOtp"]({ code: "482913" })).toBe(
      "Votre code facture.gn : 482913 (valable 5 minutes).",
    );
  });

  it("PIN modifié", () => {
    expect(fr["notification.pinChanged"]({})).toBe(
      "Votre PIN facture.gn a été changé. Si ce n'est pas vous, contactez le support.",
    );
  });

  it("invitation membre", () => {
    expect(fr["notification.memberInvite"]({ inviterName: "Aïssatou Barry" })).toBe(
      "Aïssatou Barry vous invite à rejoindre facture.gn. Inscrivez-vous sur facture.gn pour accéder à votre espace.",
    );
  });
});
