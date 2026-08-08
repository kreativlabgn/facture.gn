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

    const request = context.switchToHttp().getRequest();
    const organizationId = await this.resolveOrganizationId(request);

    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: request.user.id } },
    });

    if (!membership || membership.revokedAt || !requiredRoles.includes(membership.role)) {
      throw new ForbiddenException("Rôle insuffisant pour cette action");
    }

    return true;
  }

  // MVP : deux sources suffisent au périmètre actuel (organizations/invoices) —
  // organizationId direct dans le body à la création, ou résolu depuis la facture
  // pointée par :id pour issue/void. À généraliser si Money/Capital Context
  // introduisent d'autres formes de routes protégées par rôle.
  private async resolveOrganizationId(request: any): Promise<string> {
    if (request.body?.organizationId) {
      return request.body.organizationId;
    }
    if (request.params?.id) {
      // findUnique + 404 explicite plutôt que findUniqueOrThrow : une NotFoundError
      // Prisma non interceptée fuiterait en 500 brut plutôt qu'une réponse propre.
      const invoice = await this.prisma.invoice.findUnique({ where: { id: request.params.id } });
      if (!invoice) {
        throw new NotFoundException(`Facture ${request.params.id} introuvable`);
      }
      return invoice.organizationId;
    }
    throw new ForbiddenException("Impossible de déterminer l'organisation ciblée par cette requête");
  }
}
