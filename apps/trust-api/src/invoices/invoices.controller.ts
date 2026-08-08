import { Body, Controller, Param, Post, UsePipes } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { createInvoiceSchema, type CreateInvoiceDto } from "./dto/create-invoice.dto";
import { InvoicesService } from "./invoices.service";

@ApiTags("invoices")
@Controller("invoices")
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(createInvoiceSchema))
  create(@Body() dto: CreateInvoiceDto) {
    return this.invoicesService.createDraft(dto);
  }

  @Post(":id/issue")
  issue(@Param("id") id: string) {
    return this.invoicesService.issue(id);
  }

  @Post(":id/void")
  void(@Param("id") id: string) {
    return this.invoicesService.void(id);
  }
}
