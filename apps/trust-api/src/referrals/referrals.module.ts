import { Global, Module } from "@nestjs/common";
import { ReferralsController } from "./referrals.controller";
import { ReferralsService } from "./referrals.service";

// @Global : OrganizationsService déclenche la conversion au changement de
// palier. Même arbitrage que CreditsModule, dont ce module dépend.
@Global()
@Module({
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
