import { Global, Module } from "@nestjs/common";
import { CreditsController, InternalCreditsController } from "./credits.controller";
import { CreditsInternalAuthGuard } from "./credits-internal-auth.guard";
import { CreditsService } from "./credits.service";

// @Global : la consommation de crédits se branche là où part un envoi payant —
// aujourd'hui InvoicesService.sendReminder, demain ailleurs. Faire réimporter
// ce module par chaque appelant multiplierait les imports sans rien apporter,
// même arbitrage que CertificationModule (clés de signature).
@Global()
@Module({
  controllers: [CreditsController, InternalCreditsController],
  providers: [CreditsService, CreditsInternalAuthGuard],
  exports: [CreditsService],
})
export class CreditsModule {}
