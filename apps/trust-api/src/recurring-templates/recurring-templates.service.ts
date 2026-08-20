import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { InvoicesService } from "../invoices/invoices.service";
import type { CreateRecurringTemplateDto } from "./dto/create-recurring-template.dto";

@Injectable()
export class RecurringTemplatesService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly invoicesService: InvoicesService,
  ) {}

  // I1, ADR-056 — lastKnownRegimeFiscal n'est JAMAIS un taux/régime figé pour la
  // facturation (générée fraîchement à chaque appel de generate(), voir
  // InvoicesService.createDraft()) : c'est uniquement une référence de
  // comparaison pour détecter une dérive et déclencher regime_change.
  async create(organizationId: string, dto: CreateRecurringTemplateDto) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    return this.prisma.recurringInvoiceTemplate.create({
      data: {
        organizationId,
        customerId: dto.customerId,
        branchId: dto.branchId,
        lines: dto.lines,
        discountPct: dto.discountPct,
        intervalDays: dto.intervalDays,
        lastGeneratedAt: null,
        lastKnownRegimeFiscal: organization.regimeFiscal,
      },
    });
  }
}
