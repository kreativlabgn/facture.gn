import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PrismaModule } from "./common/prisma.module";
import { CertificationModule } from "./certification/certification.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { InvoicesModule } from "./invoices/invoices.module";
import { VerificationModule } from "./verification/verification.module";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./common/rbac/roles.guard";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    CertificationModule,
    OrganizationsModule,
    InvoicesModule,
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
