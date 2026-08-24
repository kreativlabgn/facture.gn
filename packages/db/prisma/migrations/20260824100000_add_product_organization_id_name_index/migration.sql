-- E3/E10, ADR-038 — index composite requis par ProductsService.create(), qui
-- fait un findFirst({organizationId, name}) non indexé à chaque création
-- (dédoublonnage par nom). Même raison que customer_phone_idx
-- (20260823130000_add_customer_phone_index). Sert aussi GET /products
-- (orderBy name, scopé organizationId).
CREATE INDEX "product_organization_id_name_idx" ON "product"("organization_id", "name");
