import type { NotificationChannel } from "@facture-gn/db";
import type { NotificationProvider } from "./notification-provider.interface";

// I2 — extrait de PaymentLinkNotificationService (comportement identique,
// jamais dupliqué) pour être réutilisé par tout futur envoi best-effort
// SMS/WhatsApp basé sur Customer.notificationChannel.
export function resolveNotificationProviders(
  channel: NotificationChannel,
  smsProvider: NotificationProvider,
  whatsappProvider: NotificationProvider,
): NotificationProvider[] {
  if (channel === "both") {
    return [smsProvider, whatsappProvider];
  }
  return channel === "whatsapp" ? [whatsappProvider] : [smsProvider];
}
