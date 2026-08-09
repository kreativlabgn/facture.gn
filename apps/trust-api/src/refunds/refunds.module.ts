import { Module } from "@nestjs/common";
import { RefundsController } from "./refunds.controller";
import { RefundsService } from "./refunds.service";

@Module({
  controllers: [RefundsController],
  providers: [RefundsService],
})
export class RefundsModule {}
