import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { OUTSTANDING_INVOICE_STATUSES } from "../invoices/invoice-status";

const DEFAULT_LIST_PAGE_SIZE = 50;
const MAX_LIST_PAGE_SIZE = 100;

export interface ClientPortalOrganizationSummary {
  organizationId: string;
  organizationName: string;
  customerId: string;
  runningBalance: bigint;
  creditLimit: bigint | null;
}

// F13, ADR-096 — jamais RolesGuard/@Roles() ici : client_portal n'est pas un
// OrganizationMember, l'autorisation est entièrement inline, basée sur la
// correspondance Customer.phone ∈ numéros vérifiés de l'appelant (résolu
// ailleurs, ClientPortalAuthService). Contrôleur : voir client-portal.controller.ts.
@Injectable()
export class ClientPortalService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // Toutes les organisations où un CUSTOMER correspond à un des numéros vérifiés
  // de cet utilisateur — jamais un numéro non vérifié (verifiedAt: null), qui
  // n'est qu'une déclaration non prouvée (ADR-087/096, même garantie que
  // UssdAuthService/AuthService). Un seul groupBy pour le solde dû de TOUS les
  // clients trouvés (pas un aggregate par organisation en boucle — Quality Audit
  // 2026-08-23, même leçon N+1 déjà corrigée sur RevenueShareService.generate()).
  async listOrganizations(userId: string): Promise<ClientPortalOrganizationSummary[]> {
    const verifiedPhones = await this.prisma.userPhone.findMany({
      where: { userId, verifiedAt: { not: null } },
    });
    if (verifiedPhones.length === 0) {
      return [];
    }

    const customers = await this.prisma.customer.findMany({
      where: { phone: { in: verifiedPhones.map((p) => p.msisdn) } },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (customers.length === 0) {
      return [];
    }

    const balances = await this.prisma.invoice.groupBy({
      by: ["customerId"],
      where: {
        customerId: { in: customers.map((c) => c.id) },
        status: { in: [...OUTSTANDING_INVOICE_STATUSES] },
      },
      _sum: { amountDue: true },
    });
    const balanceByCustomerId = new Map(balances.map((b) => [b.customerId as string, b._sum.amountDue ?? 0n]));

    return customers.map((customer) => ({
      organizationId: customer.organizationId,
      organizationName: customer.organization.name,
      customerId: customer.id,
      runningBalance: balanceByCustomerId.get(customer.id) ?? 0n,
      creditLimit: customer.creditLimit,
    }));
  }

  // NotFoundException dans les deux cas (customerId inexistant OU téléphone ne
  // correspondant à aucun numéro vérifié de l'appelant) — jamais un message
  // distinct qui confirmerait à un appelant non autorisé qu'un customerId donné
  // existe bel et bien ailleurs (même discipline anti-énumération que
  // RolesGuard : 404, pas 403, sur une ressource dont on ne veut jamais prouver
  // l'existence à qui n'y a pas droit).
  async listInvoices(userId: string, customerId: string, pagination: { take?: number; skip?: number }) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      throw new NotFoundException(`Client ${customerId} introuvable`);
    }

    const verifiedPhones = await this.prisma.userPhone.findMany({
      where: { userId, verifiedAt: { not: null } },
    });
    const ownsThisCustomer = verifiedPhones.some((p) => p.msisdn === customer.phone);
    if (!ownsThisCustomer) {
      throw new NotFoundException(`Client ${customerId} introuvable`);
    }

    const take = Math.min(pagination.take ?? DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
    const skip = pagination.skip ?? 0;

    return this.prisma.invoice.findMany({
      where: {
        customerId: customer.id,
        organizationId: customer.organizationId,
        // F13, revue post-fix #1 — même exclusion que PublicBuyerPortalService
        // (public-buyer-portal.service.ts) : draft exclu car jamais réellement
        // émise/certifiée par la PME (mutable, pas encore "reçue" légitimement) ;
        // voided exclu car plus aucune dette réelle. Sans ce filtre, un client
        // externe verrait des brouillons internes de la PME.
        status: { notIn: ["draft", "voided"] as Array<"draft" | "voided"> },
      },
      orderBy: { issuedAt: "desc" },
      take,
      skip,
    });
  }
}
