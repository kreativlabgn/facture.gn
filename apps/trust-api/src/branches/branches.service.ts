import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { maxBranchesForTier } from "../common/plan-features-grid";
import type { CreateBranchDto } from "./dto/create-branch.dto";

const REVENUE_INVOICE_STATUSES = ["issued", "partially_paid", "paid"] as const;

@Injectable()
export class BranchesService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // H1, Grille §2 — garde de palier commercial : jamais de plafond sur le
  // volume de factures (§1.1), mais les succursales font partie des
  // fonctionnalités qui différencient les paliers.
  // RLS — `organizationId` vient du RolesGuard (@CurrentOrganizationId), pas
  // de `dto.organizationId` : sur une création sans params.id le guard résout
  // depuis le corps, donc les deux coïncident — mais c'est la valeur
  // effectivement AUTORISÉE qu'on lit et qu'on écrit. Aucune transaction ici,
  // donc aucun setOrganizationScope() : le client scopé suffit.
  async create(dto: CreateBranchDto, organizationId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const organization = await scoped.organization.findFirstOrThrow({
      where: { id: organizationId },
    });
    const maxBranches = maxBranchesForTier(organization.commercialTier);
    if (maxBranches !== null) {
      const activeBranchCount = await scoped.branch.count({
        where: { organizationId },
      });
      if (activeBranchCount >= maxBranches) {
        throw new ForbiddenException(
          `Palier ${organization.commercialTier} limité à ${maxBranches} succursale(s) — upgrade requis`,
        );
      }
    }

    return scoped.branch.create({
      data: { organizationId, name: dto.name, type: dto.type },
    });
  }

  // E1, ADR-037 — totalRevenue n'est jamais stocké : agrégé à la demande sur les
  // VRAIES factures (documentType "invoice", jamais proforma/devis, qui ne
  // constituent jamais un CA réel) déjà facturées (issued/partially_paid/paid —
  // contrairement à C6/runningBalance qui ne compte QUE le solde encore dû, le CA
  // compte le total facturé quel que soit l'état de paiement).
  async findOneWithRevenue(branchId: string, organizationId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const branch = await scoped.branch.findFirstOrThrow({ where: { id: branchId, organizationId } });
    // `organizationId` ajouté au where de l'agrégat : sans lui, un branchId
    // suffisait à agréger le CA, la succursale étant la seule contrainte.
    // C'est la double clause, sur une table à colonne organization_id directe.
    const aggregate = await scoped.invoice.aggregate({
      where: {
        branchId,
        organizationId,
        documentType: "invoice",
        status: { in: [...REVENUE_INVOICE_STATUSES] },
      },
      _sum: { totalTtc: true },
    });

    return { ...branch, totalRevenue: aggregate._sum.totalTtc ?? 0n };
  }
}
