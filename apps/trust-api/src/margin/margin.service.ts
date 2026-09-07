import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";

// Même filtre que FecService (F9) : une facture réellement vendue, jamais un
// brouillon jamais émis ni une facture annulée — "marge RÉALISÉE" (Backlog E7).
const REAL_SALE_STATUSES = ["issued", "partially_paid", "paid"] as const;

// Quality Audit 2026-08-23, finding #6 — même convention que InvoicesService/
// CustomersService (DEFAULT_LIST_PAGE_SIZE/MAX_LIST_PAGE_SIZE).
const DEFAULT_LIST_PAGE_SIZE = 50;
const MAX_LIST_PAGE_SIZE = 100;

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
  //
  // Quality Audit 2026-08-23, finding #6 — pagination ajoutée (même convention
  // take/skip que les autres listes de ce repo) : cette méthode servait tout
  // l'historique de lignes vendues de l'organisation sans limite, contraire à
  // la convention déjà établie ailleurs ("une réponse non bornée n'est jamais
  // acceptable").
  async listLines(
    organizationId: string,
    options: { take?: number; skip?: number } = {},
  ): Promise<LineMargin[]> {
    const take = Math.min(options.take ?? DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
    const skip = options.skip ?? 0;
    const lines = await this.fetchLines(organizationId, { take, skip });
    return lines.map(mapLineMargin);
  }

  // `invoice_line` est sous org_isolation par INDIRECTION (via invoice_id) :
  // la jointure `invoice: { organizationId }` est l'équivalent explicite de la
  // double clause. Point d'accès unique aux lignes — listLines() comme
  // listByProduct() passent par ici, donc une seule adoption suffit.
  private async fetchLines(organizationId: string, pagination: { take?: number; skip?: number }) {
    return organizationScopedClient(this.prisma, organizationId).invoiceLine.findMany({
      where: {
        invoice: { organizationId, status: { in: [...REAL_SALE_STATUSES] } },
        productId: { not: null },
      },
      include: {
        product: { select: { id: true, name: true } },
        invoice: { select: { id: true } },
      },
      orderBy: { id: "asc" },
      ...pagination,
    });
  }

  // Agrégation JS (pas un groupBy Prisma) : linesWithoutCostCount doit rester
  // visible séparément, jamais mélangé silencieusement dans totalMarginGnf.
  // Quality Audit 2026-08-23, finding #6 — appelle fetchLines() directement
  // (SANS pagination) plutôt que listLines() : cet agrégat doit porter sur
  // TOUT l'historique pour être correct, une version paginée de totalMarginGnf
  // serait silencieusement fausse (partielle). Le risque de charge non bornée
  // que finding #6 signale reste donc présent ICI par nature de l'agrégat —
  // à revisiter avec un vrai groupBy Prisma si le volume devient un problème
  // réel, hors scope de ce correctif (qui cible la liste brute paginée).
  async listByProduct(organizationId: string) {
    const rawLines = await this.fetchLines(organizationId, {});
    const lines = rawLines.map(mapLineMargin);

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

function mapLineMargin(line: {
  invoice: { id: string };
  product: { id: string; name: string } | null;
  quantity: number;
  unitPrice: bigint;
  costPriceAtTime: bigint | null;
}): LineMargin {
  const { marginGnf, marginPct } = computeMargin(line.unitPrice, line.costPriceAtTime, line.quantity);
  return {
    invoiceId: line.invoice.id,
    // Non-null garanti par le filtre productId: { not: null } de fetchLines(),
    // jamais une supposition aveugle (même principe que invoice.number!/
    // issuedAt! dans FecService.export()).
    productId: line.product!.id,
    productName: line.product!.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    costPriceAtTime: line.costPriceAtTime,
    marginGnf,
    marginPct,
  };
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
