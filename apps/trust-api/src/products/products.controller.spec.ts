import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { IS_PUBLIC_KEY } from "../auth/public.decorator";
import { ROLES_KEY } from "../common/rbac/roles.decorator";
import { ORGANIZATION_ID_SOURCE_KEY } from "../common/rbac/organization-id-source.decorator";
import { ProductsController } from "./products.controller";

// Pas d'infra e2e (supertest) dans ce repo — même convention que
// organizations.controller.spec.ts / verification.controller.spec.ts : on
// vérifie directement les métadonnées lues par RolesGuard/JwtAuthGuard,
// plutôt qu'une requête HTTP réelle.
//
// QA — catalogue produits/services (2026-09-16) : aucun test ne couvrait
// jusqu'ici le CÂBLAGE (decorators) du contrôleur produits (RBAC owner/admin,
// masquage 404 inter-organisation, absence de route publique). La logique
// elle-même (RolesGuard.canActivate, résolution idSource "product") est déjà
// testée génériquement dans roles.guard.spec.ts, mais rien ne garantissait que
// ces décorateurs restent effectivement posés sur les bons handlers de
// ProductsController au fil du temps — un retrait accidentel de @Roles() ou
// @OrganizationIdSource("product") sur update()/findOne()/setCostPrice()
// aurait pu passer inaperçu.
describe("ProductsController — RBAC et résolution d'organisation (câblage des décorateurs)", () => {
  const reflector = new Reflector();

  it.each([
    ["create (POST /products)", ProductsController.prototype.create],
    ["update (PATCH /products/:id)", ProductsController.prototype.update],
    ["findAll (GET /products)", ProductsController.prototype.findAll],
    ["findOne (GET /products/:id)", ProductsController.prototype.findOne],
    ["setCostPrice (POST /products/:id/cost-price)", ProductsController.prototype.setCostPrice],
  ])("%s est restreint exactement à owner/admin — jamais cashier ni tout autre rôle", (_label, handler) => {
    const roles = reflector.get(ROLES_KEY, handler);
    expect(roles).toEqual(["owner", "admin"]);
  });

  it.each([
    ["create (POST /products)", ProductsController.prototype.create],
    ["update (PATCH /products/:id)", ProductsController.prototype.update],
    ["findAll (GET /products)", ProductsController.prototype.findAll],
    ["findOne (GET /products/:id)", ProductsController.prototype.findOne],
    ["setCostPrice (POST /products/:id/cost-price)", ProductsController.prototype.setCostPrice],
  ])("%s n'est jamais une route @Public() — catalogue strictement interne, aucune vitrine publique", (_label, handler) => {
    const isPublic = reflector.get(IS_PUBLIC_KEY, handler);
    expect(isPublic).toBeUndefined();
  });

  it("update (PATCH /products/:id) résout l'organisation via le produit ciblé — même mécanisme de masquage 404 que setCostPrice/findOne", () => {
    const idSource = reflector.get(ORGANIZATION_ID_SOURCE_KEY, ProductsController.prototype.update);
    expect(idSource).toBe("product");
  });

  it("findOne (GET /products/:id) résout l'organisation via le produit ciblé (déjà en place, non-régression)", () => {
    const idSource = reflector.get(ORGANIZATION_ID_SOURCE_KEY, ProductsController.prototype.findOne);
    expect(idSource).toBe("product");
  });

  it("setCostPrice (POST /products/:id/cost-price) résout l'organisation via le produit ciblé (déjà en place, non-régression)", () => {
    const idSource = reflector.get(ORGANIZATION_ID_SOURCE_KEY, ProductsController.prototype.setCostPrice);
    expect(idSource).toBe("product");
  });
});

describe("ProductsController — délégation au service", () => {
  it("update() délègue à productsService.update(id, dto, organizationId)", async () => {
    const service = { update: vi.fn().mockResolvedValue({ id: "product-1", name: "Riz 25kg (nouveau)" }) };
    const controller = new ProductsController(service as any);

    const result = await controller.update("product-1", { name: "Riz 25kg (nouveau)" } as any, "org-1");

    expect(service.update).toHaveBeenCalledWith("product-1", { name: "Riz 25kg (nouveau)" }, "org-1");
    expect(result).toEqual({ id: "product-1", name: "Riz 25kg (nouveau)" });
  });
});
