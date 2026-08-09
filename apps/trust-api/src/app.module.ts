import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PrismaModule } from "./common/prisma.module";
import { CertificationModule } from "./certification/certification.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { InvoicesModule } from "./invoices/invoices.module";
import { MoneyClientModule } from "./money-client/money-client.module";
import { PaymentsModule } from "./payments/payments.module";
import { CreditNotesModule } from "./credit-notes/credit-notes.module";
import { RefundsModule } from "./refunds/refunds.module";
import { PracticesModule } from "./practices/practices.module";
import { MandatesModule } from "./mandates/mandates.module";
import { FecModule } from "./fec/fec.module";
import { CustomersModule } from "./customers/customers.module";
import { BranchesModule } from "./branches/branches.module";
import { VerificationModule } from "./verification/verification.module";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./common/rbac/roles.guard";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    CertificationModule,
    MoneyClientModule,
    OrganizationsModule,
    InvoicesModule,
    PaymentsModule,
    CreditNotesModule,
    RefundsModule,
    PracticesModule,
    MandatesModule,
    FecModule,
    CustomersModule,
    BranchesModule,
    VerificationModule,
  ],
  providers: [
    // Ordre significatif : JwtAuthGuard peuple request.user avant que RolesGuard
    // ne le lise pour résoudre le membership organisationnel.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
