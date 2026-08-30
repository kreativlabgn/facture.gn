import { Inject, Injectable, Logger } from "@nestjs/common";
import type { NotificationChannel } from "@facture-gn/db";
import { type Locale, t } from "../i18n";
import type { NotificationProvider } from "./notification-provider.interface";
import { SMS_PROVIDER, WHATSAPP_PROVIDER } from "./notifications.tokens";
import { resolveNotificationProviders } from "./notification-dispatch";

export interface NotifiableCustomer {
  phone: string | null;
  notificationChannel: NotificationChannel;
}

@Injectable()
export class PaymentLinkNotificationService {
  private readonly logger = new Logger(PaymentLinkNotificationService.name);

  constructor(
    @Inject(SMS_PROVIDER) private readonly smsProvider: NotificationProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsappProvider: NotificationProvider,
  ) {}

  // Meilleur effort, jamais couplé à l'émission déjà certifiée — même garantie
  // que PaymentLinkClient.tryGenerate() (Parcours Fanta : cash et lien ne
  // s'excluent jamais l'un l'autre). Ne lève jamais, quel que soit le résultat
  // des providers.
  async notify(
    customer: NotifiableCustomer,
    paymentLinkUrl: string,
    totalGnf: bigint,
    locale: Locale = "fr",
  ): Promise<void> {
    if (!customer.phone) {
      return;
    }

    const message = t("notification.paymentLinkReady", locale, {
      amountGnf: (totalGnf / 100n).toLocaleString("fr-FR"),
      url: paymentLinkUrl,
    });

    const providers = resolveNotificationProviders(customer.notificationChannel, this.smsProvider, this.whatsappProvider);

    await Promise.all(
      providers.map(async (provider) => {
        try {
          await provider.send(customer.phone as string, message);
        } catch (error) {
          this.logger.warn(`Échec d'envoi de notification : ${(error as Error).message}`);
        }
      }),
    );
  }
}
