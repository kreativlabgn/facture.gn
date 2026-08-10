import { Module } from "@nestjs/common";
import { OrganizationsModule } from "../organizations/organizations.module";
import { PartnersController } from "./partners.controller";
import { PartnerWebhookAuthGuard } from "./partner-webhook-auth.guard";

@Module({
  imports: [OrganizationsModule],
  controllers: [PartnersController],
  providers: [PartnerWebhookAuthGuard],
})
export class PartnersModule {}
