import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";

// Jamais persisté (voir schema.prisma, ProductStock) — type TypeScript local,
// pas un enum Prisma.
type StockMovementType = "reception" | "adjustment" | "loss";

@Injectable()
export class ProductStockService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // E10, ADR-037 — cohérence de signe validée ici (reception>0, loss<0,
  // adjustment libre), jamais persistée séparément (aucune table de ledger
  // dans l'ERD, voir PLAN). IDOR : productId vérifié contre l'organisation de
  // LA SUCCURSALE ciblée, jamais une confiance aveugle (même discipline que
  // revokeApiKey(), F15). Aucun plancher à zéro — "un stock insuffisant n'a
  // jamais bloqué l'émission d'une facture", même philosophie ici.
  async recordMovement(
    branchId: string,
    productId: string,
    type: StockMovementType,
    quantityDelta: number,
    organizationId: string,
  ) {
    this.assertSignConsistency(type, quantityDelta);

    const scoped = organizationScopedClient(this.prisma, organizationId);
    const branch = await scoped.branch.findFirstOrThrow({ where: { id: branchId, organizationId } });
    const product = await scoped.product.findFirstOrThrow({ where: { id: productId, organizationId } });
    // Contrôle CONSERVÉ malgré les deux lectures scopées : il porte le message
    // d'erreur (« introuvable pour cette organisation ») et reste la garde réelle
    // tant que les politiques dorment.
    if (product.organizationId !== branch.organizationId) {
      throw new NotFoundException(`Produit ${productId} introuvable pour cette organisation`);
    }

    // product_stock est sous RLS par INDIRECTION (politique via product_id) :
    // la table n'a pas de colonne organization_id, et le `where` d'un upsert doit
    // être unique — impossible d'y injecter le scope. Les deux lectures scopées
    // ci-dessus sont la barrière.
    return scoped.productStock.upsert({
      where: { productId_branchId: { productId, branchId } },
      create: { productId, branchId, stockQty: quantityDelta },
      update: { stockQty: { increment: quantityDelta } },
    });
  }

  // ADR-084 — costPrice jamais dans la projection, même via un include Prisma
  // large : select explicite plutôt qu'un include: { product: true } brut.
  async listByBranch(branchId: string, organizationId: string) {
    // `product: { organizationId }` est l'équivalent explicite de la double
    // clause pour une table isolée par indirection : sans lui, un branchId
    // d'une autre organisation listerait son stock si le GUC venait à manquer.
    const stocks = await organizationScopedClient(this.prisma, organizationId).productStock.findMany({
      where: { branchId, product: { organizationId } },
      include: { product: { select: { id: true, name: true } } },
    });

    return stocks.map((stock) => ({
      productId: stock.product.id,
      productName: stock.product.name,
      stockQty: stock.stockQty,
    }));
  }

  private assertSignConsistency(type: StockMovementType, quantityDelta: number): void {
    if (type === "reception" && quantityDelta <= 0) {
      throw new BadRequestException("Un mouvement reception doit avoir un quantityDelta strictement positif");
    }
    if (type === "loss" && quantityDelta >= 0) {
      throw new BadRequestException("Un mouvement loss doit avoir un quantityDelta strictement négatif");
    }
  }
}
