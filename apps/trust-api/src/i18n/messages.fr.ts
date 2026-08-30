import type { MessageCatalog } from "./messages";

// Français — source de vérité ET fallback. Chaînes reprises MOT POUR MOT de leur
// emplacement d'origine (payment-link-notification / payment-reminder /
// client-portal-otp / ussd-account / pending-member-invite) : aucun changement
// de wording dans le lot i18n. `messages.fr.spec.ts` en est la garde.
export const fr: MessageCatalog = {
  "notification.paymentLinkReady": ({ amountGnf, url }) =>
    `Votre facture de ${amountGnf} GNF est prête : ${url}`,
  "notification.paymentReminder": ({ invoiceNumber, amountGnf }) =>
    `Rappel : votre facture ${invoiceNumber} de ${amountGnf} GNF reste impayée. Merci de régulariser rapidement.`,
  "notification.clientPortalOtp": ({ code }) => `Votre code facture.gn : ${code} (valable 5 minutes).`,
  "notification.pinChanged": () =>
    "Votre PIN facture.gn a été changé. Si ce n'est pas vous, contactez le support.",
  "notification.memberInvite": ({ orgName }) =>
    `${orgName} vous invite à rejoindre facture.gn. Inscrivez-vous sur facture.gn pour accéder à votre espace.`,
};
