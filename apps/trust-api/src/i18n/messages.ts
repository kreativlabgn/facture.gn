// Catalogue des messages traduisibles. UNIQUEMENT du texte SMS/WhatsApp sortant
// (5 clés). Toute nouvelle clé DOIT être ajoutée ici (union `MessageKey`) + dans
// `messages.fr.ts` (obligatoire, source de vérité + fallback) ; `messages.pular.ts`
// est un `Partial` (stub).

export interface MessagesParams {
  "notification.paymentLinkReady": { amountGnf: string; url: string };
  "notification.paymentReminder": { invoiceNumber: string; amountGnf: string };
  "notification.clientPortalOtp": { code: string };
  "notification.pinChanged": Record<string, never>;
  "notification.memberInvite": { inviterName: string };
}

export type MessageKey = keyof MessagesParams;

export type MessageCatalog = {
  [K in MessageKey]: (params: MessagesParams[K]) => string;
};
