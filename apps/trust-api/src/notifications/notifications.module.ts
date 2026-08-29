import { Global, Module } from "@nestjs/common";
import { PaymentLinkNotificationService } from "./payment-link-notification.service";
import { PaymentReminderService } from "./payment-reminder.service";
import { SmsStubProvider } from "./sms-stub.provider";
import { WhatsAppStubProvider } from "./whatsapp-stub.provider";
import { SMS_PROVIDER, WHATSAPP_PROVIDER } from "./notifications.tokens";

// @Global() — même précédent que CertificationModule/MoneyClientModule :
// InvoicesModule consomme ces services sans les importer explicitement.
//
// SMS_PROVIDER / WHATSAPP_PROVIDER doivent être EXPORTÉS pour que le @Global
// les rende réellement visibles : plusieurs services les injectent directement
// (ClientPortalOtpService, PendingMemberInviteService, UssdAccountService) en
// supposant — à tort avant ce correctif — qu'ils étaient déjà globaux du seul
// fait du @Global. Sans cet export, l'AppModule ne se résolvait pas au
// démarrage ("Nest can't resolve dependencies ... SMS_PROVIDER"). Découvert par
// le smoke test de graphe DI (app.module.spec.ts).
@Global()
@Module({
  providers: [
    PaymentLinkNotificationService,
    PaymentReminderService,
    { provide: SMS_PROVIDER, useClass: SmsStubProvider },
    { provide: WHATSAPP_PROVIDER, useClass: WhatsAppStubProvider },
  ],
  exports: [PaymentLinkNotificationService, PaymentReminderService, SMS_PROVIDER, WHATSAPP_PROVIDER],
})
export class NotificationsModule {}
