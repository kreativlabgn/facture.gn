import { Module } from "@nestjs/common";
import { FinancingController } from "./financing.controller";
import { FinancingService } from "./financing.service";

@Module({
  controllers: [FinancingController],
  providers: [FinancingService],
})
export class FinancingModule {}
