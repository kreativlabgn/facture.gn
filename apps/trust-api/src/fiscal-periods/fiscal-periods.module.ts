import { Module } from "@nestjs/common";
import { EtaxModule } from "../etax/etax.module";
import { FiscalPeriodsController } from "./fiscal-periods.controller";
import { FiscalPeriodsService } from "./fiscal-periods.service";

// EtaxModule exporte EtaxSyncService : la clôture enfile la déclaration.
// Dépendance à sens unique — EtaxModule ne connaît pas fiscal-periods.
@Module({
  imports: [EtaxModule],
  controllers: [FiscalPeriodsController],
  providers: [FiscalPeriodsService],
})
export class FiscalPeriodsModule {}
