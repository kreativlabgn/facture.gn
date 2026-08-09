import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { CreateCustomerDto } from "./dto/create-customer.dto";

const OUTSTANDING_INVOICE_STATUSES = ["issued", "partially_paid"] as const;

@Injectable()
export class CustomersService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

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
}
