import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { Roles } from "../common/rbac/roles.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { BankReconciliationService } from "./bank-reconciliation.service";
import { confirmMatchSchema, type ConfirmMatchDto } from "./dto/confirm-match.dto";
import {
  importBankTransactionsSchema,
  type ImportBankTransactionsDto,
} from "./dto/import-bank-transactions.dto";
import {
  listBankTransactionsQuerySchema,
  type ListBankTransactionsQueryDto,
} from "./dto/list-bank-transactions-query.dto";

// Lot rapprochement bancaire (ADR-052, ADR-117 provisoire) — imbriqué sous
// /organizations/:id (comme /fiscal-periods, /margin, /fec) : aucune
// "organisation active" dans le JWT. @OrganizationIdSource("organization") sur
// chaque route → RolesGuard résout params.id directement comme un ID
// d'organisation et vérifie le rôle de l'appelant sur CETTE organisation.
//
// accountant_internal en plus de owner/admin : le rapprochement bancaire est un
// travail comptable par nature (ADR-099).
@ApiTags("bank-reconciliation")
@ApiBearerAuth()
@Controller("organizations/:id/bank-reconciliation")
export class BankReconciliationController {
  constructor(private readonly bankReconciliation: BankReconciliationService) {}

  @Post("import")
  @Roles("owner", "admin", "accountant_internal")
  @OrganizationIdSource("organization")
  import(
    @Param("id") organizationId: string,
    @Body(new ZodValidationPipe(importBankTransactionsSchema)) dto: ImportBankTransactionsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.bankReconciliation.importTransactions(organizationId, dto, user.id);
  }

  @Get("transactions")
  @Roles("owner", "admin", "accountant_internal")
  @OrganizationIdSource("organization")
  listTransactions(
    @Param("id") organizationId: string,
    @Query(new ZodValidationPipe(listBankTransactionsQuerySchema)) query: ListBankTransactionsQueryDto,
  ) {
    return this.bankReconciliation.listTransactions(organizationId, query);
  }

  @Post("transactions/:transactionId/confirm")
  @Roles("owner", "admin", "accountant_internal")
  @OrganizationIdSource("organization")
  confirm(
    @Param("id") organizationId: string,
    @Param("transactionId") transactionId: string,
    @Body(new ZodValidationPipe(confirmMatchSchema)) dto: ConfirmMatchDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.bankReconciliation.confirmMatch(organizationId, transactionId, dto.invoiceId, user.id);
  }

  @Post("transactions/:transactionId/ignore")
  @Roles("owner", "admin", "accountant_internal")
  @OrganizationIdSource("organization")
  ignore(
    @Param("id") organizationId: string,
    @Param("transactionId") transactionId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.bankReconciliation.ignoreTransaction(organizationId, transactionId, user.id);
  }
}
