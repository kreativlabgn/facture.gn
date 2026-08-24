import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import {
  organizationScopedListQuerySchema,
  type OrganizationScopedListQueryDto,
} from "../common/dto/organization-scoped-list-query.dto";
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

  // UI backlog gap comblé ici — catalogue produit (liste + détail). Même trio
  // restreint que create()/setCostPrice() (jamais inventory_manager, E10).
  // organizationId résolu depuis la query par RolesGuard, même schéma partagé
  // que GET /invoices et GET /customers.
  @Get()
  @Roles("owner", "admin")
  findAll(@Query(new ZodValidationPipe(organizationScopedListQuerySchema)) query: OrganizationScopedListQueryDto) {
    return this.productsService.findAllByOrganization(query.organizationId, {
      take: query.take,
      skip: query.skip,
    });
  }

  // idSource "product" déjà branché dans roles.guard.ts (réutilisé tel quel,
  // utilisé aujourd'hui par setCostPrice()).
  @Get(":id")
  @Roles("owner", "admin")
  @OrganizationIdSource("product")
  findOne(@Param("id") id: string) {
    return this.productsService.findOneWithDuplicate(id);
  }
}
