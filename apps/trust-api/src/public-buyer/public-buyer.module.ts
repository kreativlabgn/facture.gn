import { Module } from "@nestjs/common";
import { PublicBuyerAccountsController } from "./public-buyer-accounts.controller";
import { PublicBuyerAccountsService } from "./public-buyer-accounts.service";
import { PublicBuyerPortalController } from "./public-buyer-portal.controller";
import { PublicBuyerPortalService } from "./public-buyer-portal.service";

@Module({
  controllers: [PublicBuyerAccountsController, PublicBuyerPortalController],
  providers: [PublicBuyerAccountsService, PublicBuyerPortalService],
  exports: [PublicBuyerAccountsService, PublicBuyerPortalService],
})
export class PublicBuyerModule {}
