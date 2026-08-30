// Catalogue des messages traduisibles. UNIQUEMENT du texte SMS/WhatsApp sortant
// (5 clés). Toute nouvelle clé DOIT être ajoutée ici (union `MessageKey`) + dans
// `messages.fr.ts` (obligatoire, source de vérité + fallback) ; `messages.pular.ts`
// est un `Partial` (stub).

export interface MessagesParams {
  "notification.paymentLinkReady": { amountGnf: string; url: string };
  "notification.paymentReminder": { invoiceNumber: string; amountGnf: string };
  "notification.clientPortalOtp": { code: string };
  "notification.pinChanged": Record<string, never>;
  // orgName : le nom de l'organisation (ou du cabinet) qui invite, pas d'une personne.
  "notification.memberInvite": { orgName: string };
}

export type MessageKey = keyof MessagesParams;

export type MessageCatalog = {
  [K in MessageKey]: (params: MessagesParams[K]) => string;
};
