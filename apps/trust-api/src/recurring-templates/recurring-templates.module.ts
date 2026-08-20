import { Module } from "@nestjs/common";
import { InvoicesModule } from "../invoices/invoices.module";
import { RecurringTemplateGenerationController, RecurringTemplatesController } from "./recurring-templates.controller";
import { RecurringTemplatesService } from "./recurring-templates.service";

@Module({
  imports: [InvoicesModule],
  controllers: [RecurringTemplatesController, RecurringTemplateGenerationController],
  providers: [RecurringTemplatesService],
})
export class RecurringTemplatesModule {}
