import { Module } from "@nestjs/common";
import { CommissionBypassEscalationService } from "./commission-bypass-escalation.service";
import { CommissionBypassReviewService } from "./commission-bypass-review.service";
import { CommissionBypassCasesController } from "./commission-bypass-cases.controller";
import { CommissionBypassCaseResolutionController } from "./commission-bypass-case-resolution.controller";

@Module({
  // Contrôleurs de revue enregistrés ici : le module est importé deux fois
  // (PaymentsModule pour CommissionBypassEscalationService, AppModule pour ces
  // contrôleurs) — même précédent que MoneyClientModule (app.module.ts).
  controllers: [CommissionBypassCasesController, CommissionBypassCaseResolutionController],
  providers: [CommissionBypassEscalationService, CommissionBypassReviewService],
  exports: [CommissionBypassEscalationService],
})
export class CommissionBypassModule {}
