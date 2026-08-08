import { Module } from "@nestjs/common";
import { PaymentConfirmationClient } from "./payment-confirmation-client";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";

@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, PaymentConfirmationClient],
})
export class WebhooksModule {}
