import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { CurrentOrganizationId } from "../common/rbac/current-organization-id.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { recordStockMovementSchema, type RecordStockMovementDto } from "./dto/record-stock-movement.dto";
import { ProductStockService } from "./product-stock.service";

// E10, ADR-037 — imbriqué sous /branches/:id (idSource "branch" déjà existant
// et testé, E1) : aucune modification de RolesGuard requise.
@ApiTags("product-stock")
@ApiBearerAuth()
@Controller("branches/:id/product-stock")
export class ProductStockController {
  constructor(private readonly productStockService: ProductStockService) {}

  @Get()
  @Roles("owner", "admin", "inventory_manager")
  @OrganizationIdSource("branch")
  list(@Param("id") branchId: string, @CurrentOrganizationId() organizationId: string) {
    return this.productStockService.listByBranch(branchId, organizationId);
  }

  @Post(":productId/movements")
  @Roles("owner", "admin", "inventory_manager")
  @OrganizationIdSource("branch")
  recordMovement(
    @Param("id") branchId: string,
    @Param("productId") productId: string,
    @Body(new ZodValidationPipe(recordStockMovementSchema)) dto: RecordStockMovementDto,
    @CurrentOrganizationId() organizationId: string,
  ) {
    return this.productStockService.recordMovement(
      branchId,
      productId,
      dto.type,
      dto.quantityDelta,
      organizationId,
    );
  }
}
