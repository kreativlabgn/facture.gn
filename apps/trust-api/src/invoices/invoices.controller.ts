import { Body, Controller, Param, Post, UsePipes } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { createInvoiceSchema, type CreateInvoiceDto } from "./dto/create-invoice.dto";
import { forfeitDepositSchema, type ForfeitDepositDto } from "./dto/forfeit-deposit.dto";
import { InvoicesService } from "./invoices.service";

@ApiTags("invoices")
@ApiBearerAuth()
@Controller("invoices")
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent")
  @UsePipes(new ZodValidationPipe(createInvoiceSchema))
  create(@Body() dto: CreateInvoiceDto) {
    return this.invoicesService.createDraft(dto);
  }

  @Post(":id/issue")
  @Roles("owner", "admin", "cashier")
  issue(@Param("id") id: string) {
    return this.invoicesService.issue(id);
  }

  @Post(":id/void")
  @Roles("owner", "admin")
  void(@Param("id") id: string) {
    return this.invoicesService.void(id);
  }

  // Même trio que /issue (owner/admin/cashier) — portée similaire, transforme un
  // document en facture réellement facturable (C15).
  @Post(":id/convert-to-invoice")
  @Roles("owner", "admin", "cashier")
  convertToInvoice(@Param("id") id: string) {
    return this.invoicesService.convertToInvoice(id);
  }

  // Même trio que /issue et /convert-to-invoice — action conséquente déclenchée par
  // le staff (C5, ADR-034).
  @Post(":id/forfeit-deposit")
  @Roles("owner", "admin", "cashier")
  forfeitDeposit(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(forfeitDepositSchema)) dto: ForfeitDepositDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.invoicesService.forfeitDeposit(id, dto.reason, user.id);
  }
}
