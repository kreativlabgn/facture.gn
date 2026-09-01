import { Module } from "@nestjs/common";

import { PaymentsModule } from "../payments/payments.module";
import { BankReconciliationController } from "./bank-reconciliation.controller";
import { BankReconciliationService } from "./bank-reconciliation.service";

// Lot rapprochement bancaire (ADR-052, ADR-117 provisoire) — réutilise
// PaymentsService.recordBankTransferPayment (chemin C3) : PaymentsModule
// l'exporte désormais.
@Module({
  imports: [PaymentsModule],
  controllers: [BankReconciliationController],
  providers: [BankReconciliationService],
})
export class BankReconciliationModule {}
