import { Global, Module } from "@nestjs/common";
import { PaymentLinkClient } from "./payment-link-client";

@Global()
@Module({
  providers: [PaymentLinkClient],
  exports: [PaymentLinkClient],
})
export class MoneyClientModule {}
