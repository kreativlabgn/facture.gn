import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";

// Même filtre que FecService (F9) : une facture réellement vendue, jamais un
// brouillon jamais émis ni une facture annulée — "marge RÉALISÉE" (Backlog E7).
const REAL_SALE_STATUSES = ["issued", "partially_paid", "paid"] as const;

interface LineMargin {
  invoiceId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: bigint;
  costPriceAtTime: bigint | null;
  marginGnf: bigint | null;
  marginPct: number | null;
}

@Injectable()
export class MarginService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // ADR-084 — "jamais recalculée rétroactivement" : marge dérivée uniquement
  // de costPriceAtTime (snapshot), jamais d'une jointure live sur
  // Product.costPrice. Une ligne sans costPriceAtTime a une marge NON
  // CALCULABLE (null), jamais 0 — un stock vendu sans coût renseigné n'est
  // pas une vente à marge nulle, c'est une donnée absente.
  async listLines(organizationId: string): Promise<LineMargin[]> {
    const lines = await this.prisma.invoiceLine.findMany({
      where: {
        invoice: { organizationId, status: { in: [...REAL_SALE_STATUSES] } },
        productId: { not: null },
      },
      include: {
        product: { select: { id: true, name: true } },
        invoice: { select: { id: true } },
      },
    });

    return lines.map((line) => {
      const { marginGnf, marginPct } = computeMargin(line.unitPrice, line.costPriceAtTime, line.quantity);
      return {
        invoiceId: line.invoice.id,
        productId: line.product!.id,
        productName: line.product!.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        costPriceAtTime: line.costPriceAtTime,
        marginGnf,
        marginPct,
      };
    });
  }

  // Agrégation JS (pas un groupBy Prisma) : linesWithoutCostCount doit rester
  // visible séparément, jamais mélangé silencieusement dans totalMarginGnf.
  async listByProduct(organizationId: string) {
    const lines = await this.listLines(organizationId);

    const byProduct = new Map<
      string,
      { productId: string; productName: string; totalMarginGnf: bigint; lineCount: number; linesWithoutCostCount: number }
    >();

    for (const line of lines) {
      const entry = byProduct.get(line.productId) ?? {
        productId: line.productId,
        productName: line.productName,
        totalMarginGnf: 0n,
        lineCount: 0,
        linesWithoutCostCount: 0,
      };
      entry.lineCount += 1;
      if (line.marginGnf === null) {
        entry.linesWithoutCostCount += 1;
      } else {
        entry.totalMarginGnf += line.marginGnf;
      }
      byProduct.set(line.productId, entry);
    }

    return [...byProduct.values()];
  }
}

function computeMargin(
  unitPrice: bigint,
  costPriceAtTime: bigint | null,
  quantity: number,
): { marginGnf: bigint | null; marginPct: number | null } {
  if (costPriceAtTime === null) {
    return { marginGnf: null, marginPct: null };
  }
  const marginPerUnit = unitPrice - costPriceAtTime;
  const marginGnf = marginPerUnit * BigInt(quantity);
  // Taux de marge sur le prix de vente (unitPrice), pas sur le coût (markup) —
  // convention retenue faute de précision du Backlog, ajustable en un point
  // unique si besoin.
  const marginPct = unitPrice > 0n ? Number((marginPerUnit * 10_000n) / unitPrice) / 100 : 0;
  return { marginGnf, marginPct };
}
