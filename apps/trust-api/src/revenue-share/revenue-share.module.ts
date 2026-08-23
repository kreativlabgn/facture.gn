import { Module } from "@nestjs/common";
import { PartnerSubscriptionController, RevenueShareController } from "./revenue-share.controller";
import { RevenueShareService } from "./revenue-share.service";

@Module({
  controllers: [RevenueShareController, PartnerSubscriptionController],
  providers: [RevenueShareService],
})
export class RevenueShareModule {}
