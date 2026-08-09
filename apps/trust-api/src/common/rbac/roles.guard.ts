import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { OrganizationRole, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../prisma.module";
import { ROLES_KEY } from "./roles.decorator";
import { ORGANIZATION_ID_SOURCE_KEY } from "./organization-id-source.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<OrganizationRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Défaut "invoice" : rétrocompatible avec toutes les routes existantes qui ne
    // déclarent pas @OrganizationIdSource() (issue/void/...).
    const idSource =
      this.reflector.getAllAndOverride<"invoice" | "organization" | "credit-note" | "customer" | undefined>(
        ORGANIZATION_ID_SOURCE_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? "invoice";

    const request = context.switchToHttp().getRequest();
    const organizationId = await this.resolveOrganizationId(request, idSource);

    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: request.user.id } },
    });

    if (!membership || membership.revokedAt || !requiredRoles.includes(membership.role)) {
      throw new ForbiddenException("Rôle insuffisant pour cette action");
    }

    return true;
  }

  // organizationId direct dans le body à la création, ou résolu depuis params.id —
  // une facture (issue/void/...), une organisation (E8, trust-score) ou un avoir
  // (C13, refunds) selon @OrganizationIdSource() (défaut "invoice", rétrocompatible).
  private async resolveOrganizationId(
    request: any,
    idSource: "invoice" | "organization" | "credit-note" | "customer",
  ): Promise<string> {
    if (request.body?.organizationId) {
      return request.body.organizationId;
    }
    if (request.params?.id) {
      // findUnique + 404 explicite plutôt que findUniqueOrThrow : une NotFoundError
      // Prisma non interceptée fuiterait en 500 brut plutôt qu'une réponse propre.
      if (idSource === "organization") {
        const organization = await this.prisma.organization.findUnique({ where: { id: request.params.id } });
        if (!organization) {
          throw new NotFoundException(`Organisation ${request.params.id} introuvable`);
        }
        return organization.id;
      }
      if (idSource === "credit-note") {
        const creditNote = await this.prisma.creditNote.findUnique({
          where: { id: request.params.id },
          include: { invoice: true },
        });
        if (!creditNote) {
          throw new NotFoundException(`Avoir ${request.params.id} introuvable`);
        }
        return creditNote.invoice.organizationId;
      }
      if (idSource === "customer") {
        const customer = await this.prisma.customer.findUnique({ where: { id: request.params.id } });
        if (!customer) {
          throw new NotFoundException(`Client ${request.params.id} introuvable`);
        }
        return customer.organizationId;
      }
      const invoice = await this.prisma.invoice.findUnique({ where: { id: request.params.id } });
      if (!invoice) {
        throw new NotFoundException(`Facture ${request.params.id} introuvable`);
      }
      return invoice.organizationId;
    }
    throw new ForbiddenException("Impossible de déterminer l'organisation ciblée par cette requête");
  }
}
