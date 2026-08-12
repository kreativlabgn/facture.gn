import { Module } from "@nestjs/common";
import { InvoicesModule } from "../invoices/invoices.module";
import { CustomersModule } from "../customers/customers.module";
import { OrganizationAccessModule } from "../common/rbac/organization-access.module";
import { CabinetViewController } from "./cabinet-view.controller";

@Module({
  imports: [InvoicesModule, CustomersModule, OrganizationAccessModule],
  controllers: [CabinetViewController],
})
export class CabinetViewModule {}
