import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { CreateBranchDto } from "./dto/create-branch.dto";

const REVENUE_INVOICE_STATUSES = ["issued", "partially_paid", "paid"] as const;

@Injectable()
export class BranchesService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async create(dto: CreateBranchDto) {
    return this.prisma.branch.create({
      data: { organizationId: dto.organizationId, name: dto.name, type: dto.type },
    });
  }

  // E1, ADR-037 — totalRevenue n'est jamais stocké : agrégé à la demande sur les
  // VRAIES factures (documentType "invoice", jamais proforma/devis, qui ne
  // constituent jamais un CA réel) déjà facturées (issued/partially_paid/paid —
  // contrairement à C6/runningBalance qui ne compte QUE le solde encore dû, le CA
  // compte le total facturé quel que soit l'état de paiement).
  async findOneWithRevenue(branchId: string) {
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    const aggregate = await this.prisma.invoice.aggregate({
      where: { branchId, documentType: "invoice", status: { in: [...REVENUE_INVOICE_STATUSES] } },
      _sum: { totalTtc: true },
    });

    return { ...branch, totalRevenue: aggregate._sum.totalTtc ?? 0n };
  }
}
