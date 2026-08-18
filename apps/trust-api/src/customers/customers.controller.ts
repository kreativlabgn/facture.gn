import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import {
  organizationScopedListQuerySchema,
  type OrganizationScopedListQueryDto,
} from "../common/dto/organization-scoped-list-query.dto";
import { createCustomerSchema, type CreateCustomerDto } from "./dto/create-customer.dto";
import { importCustomersSchema, type ImportCustomersDto } from "./dto/import-customers.dto";
import { mergeCustomerSchema, type MergeCustomerDto } from "./dto/merge-customer.dto";
import { flagPublicEntitySchema, type FlagPublicEntityDto } from "./dto/flag-public-entity.dto";
import { proposeCreditLimitSchema, type ProposeCreditLimitDto } from "./dto/propose-credit-limit.dto";
import {
  resolveCreditLimitRequestSchema,
  type ResolveCreditLimitRequestDto,
} from "./dto/resolve-credit-limit-request.dto";
import { CustomersService } from "./customers.service";

@ApiTags("customers")
@ApiBearerAuth()
@Controller("customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  // Même trio élargi que POST /invoices — créer un client est une action de
  // préparation de vente, pas une action financière en soi.
  @Post()
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent")
  create(@Body(new ZodValidationPipe(createCustomerSchema)) dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  // E9, ADR-100 — "seul gap réel" signalé par l'ADR : import en masse, un seul
  // à la fois aujourd'hui. Même trio que create() ("aucune permission
  // nouvelle", Backlog E9). Pas de @OrganizationIdSource : organizationId
  // porté par le body, création — pas de ressource pré-existante à usurper.
  @Post("import")
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent")
  importCustomers(@Body(new ZodValidationPipe(importCustomersSchema)) dto: ImportCustomersDto) {
    return this.customersService.importCustomers(dto.organizationId, dto.customers);
  }

  // Sélecteur client (émission de facture) + section "liste des clients"
  // (dashboard) — aucun endpoint de liste n'existait jusqu'ici (seul findOne()
  // par id). Même trio que create()/findOne(). organizationId résolu depuis la
  // query par RolesGuard (aucun idSource params.id à déclarer ici).
  @Get()
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent")
  findAll(@Query(new ZodValidationPipe(organizationScopedListQuerySchema)) query: OrganizationScopedListQueryDto) {
    return this.customersService.findAllByOrganization(query.organizationId, {
      take: query.take,
      skip: query.skip,
    });
  }

  // C6 — idSource "customer" (jamais "invoice", :id n'est PAS une facture ici).
  @Get(":id")
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent")
  @OrganizationIdSource("customer")
  findOne(@Param("id") id: string) {
    return this.customersService.findOneWithBalance(id);
  }

  // E4, ADR-038 — "admin/owner uniquement, jamais cashier ni field_agent"
  // (bullet backlog exact) : trio restreint, contrairement à create()/findOne().
  @Post(":id/merge")
  @Roles("owner", "admin")
  @OrganizationIdSource("customer")
  merge(@Param("id") id: string, @Body(new ZodValidationPipe(mergeCustomerSchema)) dto: MergeCustomerDto) {
    return this.customersService.merge(id, dto.duplicateCustomerId);
  }

  // F16, ADR-105 — même trio restreint que merge() (E4) : réservé admin/owner,
  // même lot de permissions qu'ADR-083.
  @Post(":id/flag-public-entity")
  @Roles("owner", "admin")
  @OrganizationIdSource("customer")
  flagPublicEntity(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(flagPublicEntitySchema)) dto: FlagPublicEntityDto,
  ) {
    return this.customersService.flagPublicEntity(id, dto.publicBuyerAccountId);
  }

  // E5, ADR-083 — même trio restreint que merge() (E4) et flagPublicEntity() (F16).
  @Post(":id/credit-limit")
  @Roles("owner", "admin")
  @OrganizationIdSource("customer")
  proposeCreditLimit(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(proposeCreditLimitSchema)) dto: ProposeCreditLimitDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.customersService.proposeCreditLimit(id, dto.newLimit, user.id);
  }

  // E5, ADR-083 — idSource "credit-limit-request" (jamais "customer" : :id est
  // l'id de LA DEMANDE, pas du client). Réservé au rôle approver uniquement,
  // jamais owner/admin en substitut (RolesGuard applique déjà cette restriction).
  @Post("credit-limit-requests/:id/resolve")
  @Roles("approver")
  @OrganizationIdSource("credit-limit-request")
  resolveCreditLimitRequest(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resolveCreditLimitRequestSchema)) dto: ResolveCreditLimitRequestDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.customersService.resolveCreditLimitRequest(id, user.id, dto.decision);
  }
}
