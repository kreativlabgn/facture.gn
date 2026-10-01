import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { CurrentOrganizationId } from "../common/rbac/current-organization-id.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import {
  organizationScopedListQuerySchema,
  type OrganizationScopedListQueryDto,
} from "../common/dto/organization-scoped-list-query.dto";
import { createProductSchema, type CreateProductDto } from "./dto/create-product.dto";
import { updateProductSchema, type UpdateProductDto } from "./dto/update-product.dto";
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
  create(
    @Body(new ZodValidationPipe(createProductSchema)) dto: CreateProductDto,
    @CurrentOrganizationId() organizationId: string,
  ) {
    return this.productsService.create(dto, organizationId);
  }

  // Catalogue produits/services (2026-09-16) — édition générale d'une fiche
  // produit. Même trio owner/admin et même mécanisme idSource "product" que
  // setCostPrice()/findOne() ci-dessous (404 masqué hors organisation, déjà
  // branché dans roles.guard.ts). `type` n'apparaît jamais dans
  // updateProductSchema : immuable après création, voir update-product.dto.ts.
  // costPrice reste hors de ce endpoint — exclusivement POST :id/cost-price.
  @Patch(":id")
  @Roles("owner", "admin")
  @OrganizationIdSource("product")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) dto: UpdateProductDto,
    @CurrentOrganizationId() organizationId: string,
  ) {
    return this.productsService.update(id, dto, organizationId);
  }

  // E6, ADR-084 — même trio restreint que create() : donnée commerciale
  // sensible (territoire business_manager en lecture, jamais inventory_manager).
  @Post(":id/cost-price")
  @Roles("owner", "admin")
  @OrganizationIdSource("product")
  setCostPrice(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setCostPriceSchema)) dto: SetCostPriceDto,
    @CurrentOrganizationId() organizationId: string,
  ) {
    return this.productsService.setCostPrice(id, dto.costPrice, organizationId);
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
  findOne(@Param("id") id: string, @CurrentOrganizationId() organizationId: string) {
    return this.productsService.findOneWithDuplicate(id, organizationId);
  }
}
