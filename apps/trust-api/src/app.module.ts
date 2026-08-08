import { Module } from "@nestjs/common";
import { PrismaModule } from "./common/prisma.module";
import { CertificationModule } from "./certification/certification.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { InvoicesModule } from "./invoices/invoices.module";

@Module({
  imports: [PrismaModule, CertificationModule, OrganizationsModule, InvoicesModule],
})
export class AppModule {}
