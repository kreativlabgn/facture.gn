import { Global, Module } from "@nestjs/common";
import { PaymentLinkNotificationService } from "./payment-link-notification.service";
import { SmsStubProvider } from "./sms-stub.provider";
import { WhatsAppStubProvider } from "./whatsapp-stub.provider";
import { SMS_PROVIDER, WHATSAPP_PROVIDER } from "./notifications.tokens";

// @Global() — même précédent que CertificationModule/MoneyClientModule :
// InvoicesModule consomme ce service sans l'importer explicitement.
@Global()
@Module({
  providers: [
    PaymentLinkNotificationService,
    { provide: SMS_PROVIDER, useClass: SmsStubProvider },
    { provide: WHATSAPP_PROVIDER, useClass: WhatsAppStubProvider },
  ],
  exports: [PaymentLinkNotificationService],
})
export class NotificationsModule {}
