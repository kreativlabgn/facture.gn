import { Body, Controller, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { createCreditNoteSchema, type CreateCreditNoteDto } from "./dto/create-credit-note.dto";
import { CreditNotesService } from "./credit-notes.service";

@ApiTags("credit-notes")
@ApiBearerAuth()
@Controller("invoices/:id/credit-notes")
export class CreditNotesController {
  constructor(private readonly creditNotesService: CreditNotesService) {}

  // :id (facture) alimente RolesGuard.resolveOrganizationId() — même trio de
  // rôles que issue/convert-to-invoice/forfeit-deposit/regenerate-payment-link
  // (C7 : portée monétaire similaire, action du staff au comptoir).
  @Post()
  @Roles("owner", "admin", "cashier")
  create(@Param("id") invoiceId: string, @Body(new ZodValidationPipe(createCreditNoteSchema)) dto: CreateCreditNoteDto) {
    return this.creditNotesService.create(invoiceId, dto);
  }
}
