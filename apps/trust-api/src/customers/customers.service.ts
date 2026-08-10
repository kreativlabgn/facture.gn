import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { CreateCustomerDto } from "./dto/create-customer.dto";

const OUTSTANDING_INVOICE_STATUSES = ["issued", "partially_paid"] as const;
const DEFAULT_LIST_PAGE_SIZE = 50;
const MAX_LIST_PAGE_SIZE = 100;

@Injectable()
export class CustomersService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // Sélecteur client (émission de facture) + section "liste des clients"
  // (dashboard) — même plafonnement défensif que InvoicesService.findAllByOrganization,
  // aucun endpoint de liste n'existait jusqu'ici (seul findOne() par id).
  async findAllByOrganization(organizationId: string, pagination: { take?: number; skip?: number }) {
    const take = Math.min(pagination.take ?? DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
    const skip = pagination.skip ?? 0;
    return this.prisma.customer.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    });
  }

  async create(dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        organizationId: dto.organizationId,
        name: dto.name,
        phone: dto.phone,
        nif: dto.nif,
        creditLimit: dto.creditLimit,
      },
    });
  }

  // C6, ADR-039 — running_balance n'est jamais stocké : agrégé à la demande sur
  // les factures encore dues (issued/partially_paid). paid/voided/draft exclus
  // (respectivement soldée, sans effet, ou pas encore une dette réelle).
  async findOneWithBalance(customerId: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const aggregate = await this.prisma.invoice.aggregate({
      where: { customerId, status: { in: [...OUTSTANDING_INVOICE_STATUSES] } },
      _sum: { amountDue: true },
    });

    return { ...customer, runningBalance: aggregate._sum.amountDue ?? 0n };
  }

  // E4, ADR-038 — "jamais de fusion automatique, résolution manuelle" : cette
  // méthode EST la résolution manuelle (un admin/owner choisit explicitement les
  // deux fiches). Organisation vérifiée par comparaison directe des deux
  // organizationId chargés, jamais un paramètre transmis par l'appelant.
  async merge(canonicalCustomerId: string, duplicateCustomerId: string) {
    if (canonicalCustomerId === duplicateCustomerId) {
      throw new ConflictException("Impossible de fusionner un client avec lui-même");
    }

    const canonical = await this.prisma.customer.findUniqueOrThrow({ where: { id: canonicalCustomerId } });
    const duplicate = await this.prisma.customer.findUnique({ where: { id: duplicateCustomerId } });
    if (!duplicate || duplicate.organizationId !== canonical.organizationId) {
      throw new ConflictException(`Client ${duplicateCustomerId} introuvable pour cette organisation`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.invoice.updateMany({
        where: { customerId: duplicateCustomerId },
        data: { customerId: canonicalCustomerId },
      });
      await tx.customer.delete({ where: { id: duplicateCustomerId } });
      return tx.customer.findUniqueOrThrow({ where: { id: canonicalCustomerId } });
    });
  }
}
