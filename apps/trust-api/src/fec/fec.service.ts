import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { FEC_HEADER } from "./fec-formatting";
import { generateFecEntries } from "./fec-generation";

const FEC_ELIGIBLE_ROLES = new Set(["owner", "admin", "accountant_internal"]);

@Injectable()
export class FecService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async export(organizationId: string, requesterUserId: string): Promise<string> {
    await this.assertAccess(organizationId, requesterUserId);

    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId, documentType: "invoice", status: { in: ["issued", "partially_paid", "paid"] } },
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

  // Branche 1 (cas fréquent, une seule requête) : OrganizationMember. Branche 2
  // (seulement si la 1re échoue) : Mandate actif via une practice de l'appelant —
  // évite une requête Mandate inutile pour le cas fréquent (organisation
  // consultant son propre FEC). Tout PracticeMember actif suffit (ADR-070,
  // accountant_external doit pouvoir consulter/exporter, pas seulement
  // practice_admin — même principe que listAccessibleOrganizations(), F7).
  private async assertAccess(organizationId: string, requesterUserId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: requesterUserId } },
    });
    if (member && !member.revokedAt && FEC_ELIGIBLE_ROLES.has(member.role)) {
      return;
    }

    const activeMandate = await this.prisma.mandate.findFirst({
      where: {
        organizationId,
        status: "active",
        practice: { members: { some: { userId: requesterUserId, leftAt: null } } },
      },
    });
    if (!activeMandate) {
      throw new ForbiddenException("Aucun accès à cette organisation — ni membre habilité, ni mandat actif");
    }
  }
}
