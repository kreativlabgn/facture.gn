import { Global, Module } from "@nestjs/common";
import { PaymentLinkNotificationService } from "./payment-link-notification.service";
import { PaymentReminderService } from "./payment-reminder.service";
import { SmsStubProvider } from "./sms-stub.provider";
import { WhatsAppStubProvider } from "./whatsapp-stub.provider";
import { SMS_PROVIDER, WHATSAPP_PROVIDER } from "./notifications.tokens";

// @Global() — même précédent que CertificationModule/MoneyClientModule :
// InvoicesModule consomme ces services sans les importer explicitement.
@Global()
@Module({
  providers: [
    PaymentLinkNotificationService,
    PaymentReminderService,
    { provide: SMS_PROVIDER, useClass: SmsStubProvider },
    { provide: WHATSAPP_PROVIDER, useClass: WhatsAppStubProvider },
  ],
  exports: [PaymentLinkNotificationService, PaymentReminderService],
})
export class NotificationsModule {}
