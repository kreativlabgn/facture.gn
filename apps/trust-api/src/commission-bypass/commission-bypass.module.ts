import { Module } from "@nestjs/common";
import { CommissionBypassEscalationService } from "./commission-bypass-escalation.service";

@Module({
  providers: [CommissionBypassEscalationService],
  exports: [CommissionBypassEscalationService],
})
export class CommissionBypassModule {}
