import type { MessageCatalog } from "./messages";

// ─────────────────────────────────────────────────────────────────────────────
// PULAR (Fulfulde) — STUB. NE PAS ACTIVER EN PROD tant que ce fichier n'est pas
// complet ET relu par un locuteur natif.
//
// Toute clé ABSENTE ici → `t()` retombe silencieusement sur `messages.fr`. C'est
// volontaire : le mécanisme i18n est livré et `Organization.preferredLanguage`
// est enfin lu, mais aucun destinataire ne reçoit de pular approximatif.
//
// Pour activer une chaîne : ajouter l'entrée ci-dessous (typée par MessageCatalog),
// faire relire, puis une story produit pourra proposer `pular` comme
// `preferredLanguage`.
// ─────────────────────────────────────────────────────────────────────────────
export const pular: Partial<MessageCatalog> = {
  // "notification.pinChanged": () => "…",
  // "notification.paymentLinkReady": ({ amountGnf, url }) => "…",
  // "notification.paymentReminder": ({ invoiceNumber, amountGnf }) => "…",
  // "notification.clientPortalOtp": ({ code }) => "…",
  // "notification.memberInvite": ({ inviterName }) => "…",
};
