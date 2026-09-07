import { Inject, Injectable } from "@nestjs/common";
import type { OrganizationRole, PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { OrganizationAccessService } from "../common/rbac/organization-access.service";
import { FEC_HEADER } from "./fec-formatting";
import { generateFecEntries } from "./fec-generation";

// F14, ADR-104 — tax_controller_readonly ajouté : "consulter en lecture seule
// mes propres factures et exporter mon FEC" est le cas d'usage explicite du
// Backlog pour ce rôle.
const FEC_ELIGIBLE_ROLES: OrganizationRole[] = ["owner", "admin", "accountant_internal", "tax_controller_readonly"];

@Injectable()
export class FecService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly organizationAccess: OrganizationAccessService,
  ) {}

  // Quality Audit 2026-08-23, finding #7 — year optionnel, défaut sur l'année
  // en cours : un export FEC (OHADA/SYSCOHADA) se fait normalement par
  // exercice fiscal, jamais l'historique complet de l'organisation depuis sa
  // création (dégradation progressive garantie avec l'ancienneté du compte,
  // même préoccupation déjà traitée pour margin.listLines(), finding #6).
  async export(organizationId: string, requesterUserId: string, year?: number): Promise<string> {
    await this.organizationAccess.assertAccess(organizationId, requesterUserId, FEC_ELIGIBLE_ROLES);

    const fiscalYear = year ?? new Date().getFullYear();
    const start = new Date(Date.UTC(fiscalYear, 0, 1));
    const end = new Date(Date.UTC(fiscalYear + 1, 0, 1));

    // L'autorisation est déjà tranchée par assertAccess() ci-dessus, qui combine
    // OrganizationMember ET Mandate (un cabinet mandaté peut exporter le FEC de
    // son client). Le scope organisation reste correct dans les deux cas : c'est
    // bien le FEC de CETTE organisation qu'on exporte, jamais une vue cabinet.
    const invoices = await organizationScopedClient(this.prisma, organizationId).invoice.findMany({
      where: {
        organizationId,
        documentType: "invoice",
        status: { in: ["issued", "partially_paid", "paid"] },
        issuedAt: { gte: start, lt: end },
      },
      include: { payments: true },
    });

    // invoice.number/issuedAt sont nullables au niveau du schema (jamais
    // consommés tant que draft) mais garantis renseignés ici : le filtre status
    // ci-dessus n'admet que des factures déjà issue()'d, moment où les deux sont
    // assignés ensemble (voir invoices.service.ts:issue()). Non-null assertions
    // couvertes par cet invariant, pas une supposition aveugle.
    const fecInvoices = invoices.map((invoice) => ({
      ...invoice,
      number: invoice.number!,
      issuedAt: invoice.issuedAt!,
    }));

    return [FEC_HEADER.join("\t"), ...generateFecEntries(fecInvoices)].join("\n");
  }
}
