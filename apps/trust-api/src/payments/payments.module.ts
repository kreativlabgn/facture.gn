import { Module } from "@nestjs/common";
import { MoneyClientModule } from "../money-client/money-client.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [MoneyClientModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
