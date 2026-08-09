import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { createBranchSchema, type CreateBranchDto } from "./dto/create-branch.dto";
import { BranchesService } from "./branches.service";

@ApiTags("branches")
@ApiBearerAuth()
@Controller("branches")
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  // Même trio élargi que POST /invoices — créer une succursale est une action de
  // structuration, pas une action financière en soi.
  @Post()
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent")
  create(@Body(new ZodValidationPipe(createBranchSchema)) dto: CreateBranchDto) {
    return this.branchesService.create(dto);
  }

  // E1 — idSource "branch" (jamais "invoice", :id n'est PAS une facture ici).
  @Get(":id")
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent")
  @OrganizationIdSource("branch")
  findOne(@Param("id") id: string) {
    return this.branchesService.findOneWithRevenue(id);
  }
}
