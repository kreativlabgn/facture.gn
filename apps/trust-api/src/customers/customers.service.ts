import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { CreateCustomerDto } from "./dto/create-customer.dto";
import { DEFAULT_CREDIT_LIMIT_APPROVAL_THRESHOLD } from "./credit-limit-approval";

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
        // undefined → Prisma applique le défaut schema ("sms"), jamais dupliqué ici.
        notificationChannel: dto.notificationChannel,
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

  // F16, ADR-105 — "sans elle, le portail Niveau 2 déjà V1 n'aurait
  // structurellement aucune facture à présenter à un DAF". publicBuyerAccountId
  // vérifié explicitement (jamais une simple FK muette) : une PME ne doit pas
  // pouvoir rattacher un client à un compte acheteur public inexistant.
  async flagPublicEntity(customerId: string, publicBuyerAccountId: string) {
    const publicBuyerAccount = await this.prisma.publicBuyerAccount.findUnique({
      where: { id: publicBuyerAccountId },
    });
    if (!publicBuyerAccount) {
      throw new NotFoundException(`Compte acheteur public ${publicBuyerAccountId} introuvable`);
    }

    return this.prisma.customer.update({
      where: { id: customerId },
      data: { isPublicEntity: true, publicBuyerAccountId },
    });
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

  // E5, ADR-083 — "toute augmentation au-delà d'un seuil exige une validation
  // approver, jamais une décision unilatérale". Une baisse, ou une hausse sous
  // le seuil, s'applique immédiatement (admin/owner) : seul le dépassement
  // déclenche la mise en attente, jamais l'égalité au seuil lui-même.
  async proposeCreditLimit(customerId: string, newLimit: bigint, requestedByUserId: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: customer.organizationId },
    });
    const currentLimit = customer.creditLimit ?? 0n;
    const threshold = organization.creditLimitApprovalThreshold ?? DEFAULT_CREDIT_LIMIT_APPROVAL_THRESHOLD;
    const increase = newLimit - currentLimit;

    if (increase <= threshold) {
      return this.prisma.customer.update({ where: { id: customerId }, data: { creditLimit: newLimit } });
    }

    return this.prisma.creditLimitChangeRequest.create({
      data: {
        customerId,
        organizationId: customer.organizationId,
        requestedByUserId,
        currentLimit,
        requestedLimit: newLimit,
      },
    });
  }

  // Même pattern qu'AuthService.resolveRecovery() (auth.service.ts) : transaction
  // updateMany filtrée sur status="pending" pour la sécurité de concurrence, et
  // interdiction que le demandeur résolve sa propre demande — c'est le sens même
  // de "jamais une décision unilatérale" (ADR-083). RolesGuard (@Roles("approver"))
  // garantit déjà le rôle du résolveur en amont, jamais revérifié ici.
  async resolveCreditLimitRequest(requestId: string, resolverUserId: string, decision: "approved" | "rejected") {
    const request = await this.prisma.creditLimitChangeRequest.findUniqueOrThrow({ where: { id: requestId } });

    if (request.requestedByUserId === resolverUserId) {
      throw new ConflictException("Vous ne pouvez pas résoudre votre propre demande de hausse de limite de crédit");
    }

    const resolvedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.creditLimitChangeRequest.updateMany({
        where: { id: requestId, status: "pending" },
        data: { status: decision, resolvedAt, resolvedByUserId: resolverUserId },
      });
      if (claimed.count === 0) {
        throw new ConflictException(`Demande ${requestId} a déjà été résolue`);
      }

      if (decision === "approved") {
        await tx.customer.update({ where: { id: request.customerId }, data: { creditLimit: request.requestedLimit } });
      }

      return { ...request, status: decision, resolvedAt, resolvedByUserId: resolverUserId };
    });
  }
}
