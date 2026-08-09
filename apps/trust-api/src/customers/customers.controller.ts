import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { createCustomerSchema, type CreateCustomerDto } from "./dto/create-customer.dto";
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

  // C6 — idSource "customer" (jamais "invoice", :id n'est PAS une facture ici).
  @Get(":id")
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent")
  @OrganizationIdSource("customer")
  findOne(@Param("id") id: string) {
    return this.customersService.findOneWithBalance(id);
  }
}
