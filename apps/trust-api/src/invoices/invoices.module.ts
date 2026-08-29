import { Module } from "@nestjs/common";
import { RenderingModule } from "../rendering/rendering.module";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";
import { InvoiceNumberingService } from "./invoice-numbering.service";

@Module({
  imports: [RenderingModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceNumberingService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
