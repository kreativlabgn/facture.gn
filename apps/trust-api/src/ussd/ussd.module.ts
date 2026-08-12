import { Module } from "@nestjs/common";
import { VerificationModule } from "../verification/verification.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { MandatesModule } from "../mandates/mandates.module";
import { UssdController } from "./ussd.controller";
import { UssdSessionService } from "./ussd-session.service";
import { UssdAuthService } from "./ussd-auth.service";
import { UssdInvoiceService } from "./ussd-invoice.service";
import { UssdPaymentService } from "./ussd-payment.service";
import { UssdInvoiceListService } from "./ussd-invoice-list.service";
import { UssdAccountService } from "./ussd-account.service";
import { VelocityTierService } from "./velocity-tier.service";

@Module({
  imports: [VerificationModule, OrganizationsModule, InvoicesModule, MandatesModule],
  controllers: [UssdController],
  providers: [
    UssdSessionService,
    UssdAuthService,
    UssdInvoiceService,
    UssdPaymentService,
    UssdInvoiceListService,
    UssdAccountService,
    VelocityTierService,
  ],
})
export class UssdModule {}
