import { Module } from "@nestjs/common";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";
import { InvoiceNumberingService } from "./invoice-numbering.service";

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceNumberingService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
