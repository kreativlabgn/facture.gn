import { Module } from "@nestjs/common";
import { FiscalPeriodsController } from "./fiscal-periods.controller";
import { FiscalPeriodsService } from "./fiscal-periods.service";

@Module({
  controllers: [FiscalPeriodsController],
  providers: [FiscalPeriodsService],
})
export class FiscalPeriodsModule {}
