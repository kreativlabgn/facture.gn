import { Body, Controller, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { createProductSchema, type CreateProductDto } from "./dto/create-product.dto";
import { setCostPriceSchema, type SetCostPriceDto } from "./dto/set-cost-price.dto";
import { ProductsService } from "./products.service";

// E10 — prérequis minimal (voir PLAN "Clarifications") : réservé owner/admin,
// jamais inventory_manager (scope Backlog strictement limité aux mouvements
// de stock pour ce rôle, jamais au catalogue produit).
@ApiTags("products")
@ApiBearerAuth()
@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Roles("owner", "admin")
  create(@Body(new ZodValidationPipe(createProductSchema)) dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  // E6, ADR-084 — même trio restreint que create() : donnée commerciale
  // sensible (territoire business_manager en lecture, jamais inventory_manager).
  @Post(":id/cost-price")
  @Roles("owner", "admin")
  @OrganizationIdSource("product")
  setCostPrice(@Param("id") id: string, @Body(new ZodValidationPipe(setCostPriceSchema)) dto: SetCostPriceDto) {
    return this.productsService.setCostPrice(id, dto.costPrice);
  }
}
