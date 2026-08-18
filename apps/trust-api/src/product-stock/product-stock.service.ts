import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
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
  async recordMovement(branchId: string, productId: string, type: StockMovementType, quantityDelta: number) {
    this.assertSignConsistency(type, quantityDelta);

    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });
    if (product.organizationId !== branch.organizationId) {
      throw new NotFoundException(`Produit ${productId} introuvable pour cette organisation`);
    }

    return this.prisma.productStock.upsert({
      where: { productId_branchId: { productId, branchId } },
      create: { productId, branchId, stockQty: quantityDelta },
      update: { stockQty: { increment: quantityDelta } },
    });
  }

  // ADR-084 — costPrice jamais dans la projection, même via un include Prisma
  // large : select explicite plutôt qu'un include: { product: true } brut.
  async listByBranch(branchId: string) {
    const stocks = await this.prisma.productStock.findMany({
      where: { branchId },
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
