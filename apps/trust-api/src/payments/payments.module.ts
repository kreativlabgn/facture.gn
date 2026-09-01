import { Module } from "@nestjs/common";
import { MoneyClientModule } from "../money-client/money-client.module";
import { CommissionBypassModule } from "../commission-bypass/commission-bypass.module";
import { RenderingModule } from "../rendering/rendering.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  // CommissionBypassModule importé aussi directement dans AppModule (pour ses
  // contrôleurs de revue Squad Money) — même précédent que MoneyClientModule,
  // double-importé pour la même raison (app.module.ts:7).
  imports: [MoneyClientModule, CommissionBypassModule, RenderingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  // Lot rapprochement bancaire (ADR-052) — BankReconciliationModule réutilise
  // recordBankTransferPayment (chemin C3) plutôt que de dupliquer la logique
  // d'idempotence / paiement partiel / transitions de statut.
  exports: [PaymentsService],
})
export class PaymentsModule {}
