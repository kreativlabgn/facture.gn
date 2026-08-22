import { Inject, Injectable, Logger } from "@nestjs/common";
import type { NotificationChannel } from "@facture-gn/db";
import type { NotificationProvider } from "./notification-provider.interface";
import { SMS_PROVIDER, WHATSAPP_PROVIDER } from "./notifications.tokens";
import { resolveNotificationProviders } from "./notification-dispatch";

// I2 — phone jamais nullable ici (contrairement à NotifiableCustomer/
// PaymentLinkNotificationService, best-effort pendant l'émission) :
// InvoicesService.sendReminder() valide la présence d'un téléphone AVANT
// d'appeler ce service — l'état "rappel sans destinataire" est donc
// structurellement irreprésentable à cet endroit, jamais un guard silencieux.
export interface ReminderRecipient {
  phone: string;
  notificationChannel: NotificationChannel;
}

@Injectable()
export class PaymentReminderService {
  private readonly logger = new Logger(PaymentReminderService.name);

  constructor(
    @Inject(SMS_PROVIDER) private readonly smsProvider: NotificationProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsappProvider: NotificationProvider,
  ) {}

  // Meilleur effort — même garantie que PaymentLinkNotificationService.notify() :
  // ne lève jamais, l'action déclenchante (InvoicesService.sendReminder) reste
  // considérée réussie même si l'envoi effectif échoue côté provider.
  async send(customer: ReminderRecipient, invoiceNumber: string, amountDueGnf: bigint): Promise<void> {
    const message = `Rappel : votre facture ${invoiceNumber} de ${amountDueGnf.toLocaleString("fr-FR")} GNF reste impayée. Merci de régulariser rapidement.`;

    const providers = resolveNotificationProviders(customer.notificationChannel, this.smsProvider, this.whatsappProvider);

    await Promise.all(
      providers.map(async (provider) => {
        try {
          await provider.send(customer.phone, message);
        } catch (error) {
          this.logger.warn(`Échec d'envoi du rappel : ${(error as Error).message}`);
        }
      }),
    );
  }
}
