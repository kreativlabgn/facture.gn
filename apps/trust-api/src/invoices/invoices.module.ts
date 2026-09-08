import { Module } from "@nestjs/common";
import { EtaxModule } from "../etax/etax.module";
import { RenderingModule } from "../rendering/rendering.module";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";
import { InvoiceNumberingService } from "./invoice-numbering.service";

@Module({
  // EtaxModule expose EtaxInvoiceService (transmission unitaire à l'émission).
  // Aucun cycle : EtaxModule ne dépend d'aucun module de facturation — il
  // n'importe que tax-regime.ts, un fichier de fonctions pures.
  imports: [RenderingModule, EtaxModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceNumberingService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
