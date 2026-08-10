import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import {
  organizationScopedListQuerySchema,
  type OrganizationScopedListQueryDto,
} from "../common/dto/organization-scoped-list-query.dto";
import { createCustomerSchema, type CreateCustomerDto } from "./dto/create-customer.dto";
import { mergeCustomerSchema, type MergeCustomerDto } from "./dto/merge-customer.dto";
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
}
