import { Body, Controller, Get, Param, Post, Query, StreamableFile, UsePipes } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";

import { CurrentOrganizationId } from "../common/rbac/current-organization-id.decorator";
import { RenderingService } from "../rendering/rendering.service";
import { createInvoiceSchema, type CreateInvoiceDto } from "./dto/create-invoice.dto";
import { listInvoicesQuerySchema, type ListInvoicesQueryDto } from "./dto/list-invoices-query.dto";
import { forfeitDepositSchema, type ForfeitDepositDto } from "./dto/forfeit-deposit.dto";
import { InvoicesService } from "./invoices.service";

@ApiTags("invoices")
@ApiBearerAuth()
@Controller("invoices")
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly renderingService: RenderingService,
  ) {}

  @Post()
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent")
  @UsePipes(new ZodValidationPipe(createInvoiceSchema))
  create(@Body() dto: CreateInvoiceDto) {
    return this.invoicesService.createDraft(dto);
  }

  // F2, ADR-045, ADR-107 — aucun @Roles() : l'Agent commercial terrain
  // (User.isCommercialAgent, flag plateforme) n'est PAS un OrganizationRole, jamais de membership permanente
  // (même principe que POST /organizations/assisted, B5). Autorisation
  // entièrement en ligne dans le service (AssistedSession). Pipe scopé au
  // paramètre @Body() — un @UsePipes() au niveau méthode s'appliquerait aussi à
  // @CurrentUser(), qui échouerait alors le même schéma de validation (piège déjà
  // documenté dans organizations.controller.ts).
  @Post("assisted")
  createAssisted(
    @Body(new ZodValidationPipe(createInvoiceSchema)) dto: CreateInvoiceDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.invoicesService.createAssisted(dto, user.id);
  }

  // "Factures récentes" (dashboard) — aucun endpoint de liste n'existait jusqu'ici.
  // Même trio élargi que POST /invoices : voir les factures d'une organisation est
  // une action de suivi courant, pas une action financière en soi. organizationId
  // résolu depuis la query par RolesGuard (aucun idSource params.id à déclarer ici).
  // F14, ADR-104 — tax_controller_readonly ajouté UNIQUEMENT ici et sur findOne()
  // ci-dessous (lecture stricte), jamais sur une route d'écriture (issue/void/...).
  @Get()
  // F3, DAT §3.5 — viewer ("proche/assistant") ajouté ici et sur findOne()
  // ci-dessous UNIQUEMENT, même portée stricte que tax_controller_readonly
  // (lecture seule des factures) — jamais sur customers/audit-log/trust-score
  // ni sur FEC_ELIGIBLE_ROLES (export fiscal, hors périmètre d'un proche).
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent", "tax_controller_readonly", "viewer")
  findAll(@Query(new ZodValidationPipe(listInvoicesQuerySchema)) query: ListInvoicesQueryDto) {
    return this.invoicesService.findAllByOrganization(query.organizationId, {
      take: query.take,
      skip: query.skip,
      // Lot D — filtre optionnel par canal d'émission ("mes ventes *620#", etc.).
      emissionChannel: query.emissionChannel,
    });
  }

  // C10 — même trio élargi que POST /invoices : suivre le statut (paiement,
  // lien) d'une facture déjà créée. idSource "invoice" par défaut (RolesGuard).
  // F14, ADR-104 — tax_controller_readonly, même remarque que findAll() ci-dessus.
  @Get(":id")
  // F3, DAT §3.5 — viewer ("proche/assistant") ajouté ici et sur findOne()
  // ci-dessous UNIQUEMENT, même portée stricte que tax_controller_readonly
  // (lecture seule des factures) — jamais sur customers/audit-log/trust-score
  // ni sur FEC_ELIGIBLE_ROLES (export fiscal, hors périmètre d'un proche).
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent", "tax_controller_readonly", "viewer")
  findOne(@Param("id") id: string, @CurrentOrganizationId() organizationId: string) {
    return this.invoicesService.findOne(id, organizationId);
  }

  // Lot A — PDF de la facture certifiée. Même trio de rôles que GET /invoices/:id
  // (lecture). idSource "invoice" (défaut) : RolesGuard résout l'organisation via
  // params.id. 409 si la facture n'est pas encore émise (RenderingService).
  @Get(":id/pdf")
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent", "tax_controller_readonly", "viewer")
  async downloadPdf(@Param("id") id: string): Promise<StreamableFile> {
    const { pdf, filename } = await this.renderingService.renderInvoicePdf(id);
    return new StreamableFile(pdf, {
      type: "application/pdf",
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post(":id/issue")
  @Roles("owner", "admin", "cashier")
  issue(@Param("id") id: string, @CurrentOrganizationId() organizationId: string) {
    return this.invoicesService.issue(id, organizationId);
  }

  @Post(":id/void")
  @Roles("owner", "admin")
  void(@Param("id") id: string, @CurrentOrganizationId() organizationId: string) {
    return this.invoicesService.void(id, organizationId);
  }

  // Même trio que /issue (owner/admin/cashier) — portée similaire, transforme un
  // document en facture réellement facturable (C15).
  @Post(":id/convert-to-invoice")
  @Roles("owner", "admin", "cashier")
  convertToInvoice(@Param("id") id: string, @CurrentOrganizationId() organizationId: string) {
    return this.invoicesService.convertToInvoice(id, organizationId);
  }

  // Même trio que /issue et /convert-to-invoice — action conséquente déclenchée par
  // le staff (C5, ADR-034).
  @Post(":id/forfeit-deposit")
  @Roles("owner", "admin", "cashier")
  forfeitDeposit(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(forfeitDepositSchema)) dto: ForfeitDepositDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrganizationId() organizationId: string,
  ) {
    return this.invoicesService.forfeitDeposit(id, dto.reason, user.id, organizationId);
  }

  // Même trio que /issue et /convert-to-invoice — régénération à la demande
  // (C18, ADR-066).
  @Post(":id/regenerate-payment-link")
  @Roles("owner", "admin", "cashier")
  regeneratePaymentLink(
    @Param("id") id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrganizationId() organizationId: string,
  ) {
    return this.invoicesService.regeneratePaymentLink(id, user.id, organizationId);
  }

  // Même trio que /regenerate-payment-link — action de relance à la demande (I2).
  @Post(":id/send-reminder")
  @Roles("owner", "admin", "cashier")
  sendReminder(
    @Param("id") id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrganizationId() organizationId: string,
  ) {
    return this.invoicesService.sendReminder(id, user.id, organizationId);
  }
}
