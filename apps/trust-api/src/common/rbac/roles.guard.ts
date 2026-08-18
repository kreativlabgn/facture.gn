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
      this.reflector.getAllAndOverride<
        "invoice" | "organization" | "credit-note" | "customer" | "branch" | "credit-limit-request" | undefined
      >(ORGANIZATION_ID_SOURCE_KEY, [context.getHandler(), context.getClass()]) ?? "invoice";

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

  // FAILLE CRITIQUE corrigée ici (découverte en E2E réel pendant la revue de ce
  // diff, PRÉEXISTANTE à ce diff — voir historique) : quand la requête cible une
  // ressource déjà existante (params.id présent — issue/void/trust-score/refunds/
  // merge client/...), organizationId résolu depuis params.id doit TOUJOURS
  // primer sur body/query, jamais l'inverse. body/query sont fournis par
  // l'appelant et n'ont AUCUNE valeur probante sur l'organisation réelle de la
  // ressource ciblée — un attaquant authentifié sur SA PROPRE organisation
  // pouvait mentir sur organizationId (body OU, depuis ce diff, query) pour
  // faire passer la vérification de rôle contre son propre membership légitime,
  // puis le SERVICE (issue(), void(), ...) opérait quand même sur la VRAIE
  // ressource ciblée par params.id, jamais revérifiée contre l'organizationId
  // effectivement autorisé — vérifié en E2E réel : un attaquant B (owner de sa
  // propre organisation B) a réussi à ÉMETTRE (signature Ed25519 réelle) une
  // facture appartenant à l'organisation A, sans aucun membership sur A, en
  // envoyant `{"organizationId": "<org B>"}` dans le body (préexistant) ou
  // `?organizationId=<org B>` en query (introduit par ce diff). Seul un
  // organizationId direct au CORPS d'une création (aucun params.id, la
  // ressource n'existe pas encore — POST /invoices, etc.) est légitimement
  // fourni par l'appelant, jamais quand une ressource pré-existante est ciblée.
  private async resolveOrganizationId(
    request: any,
    idSource: "invoice" | "organization" | "credit-note" | "customer" | "branch" | "credit-limit-request",
  ): Promise<string> {
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
      if (idSource === "branch") {
        const branch = await this.prisma.branch.findUnique({ where: { id: request.params.id } });
        if (!branch) {
          throw new NotFoundException(`Succursale ${request.params.id} introuvable`);
        }
        return branch.organizationId;
      }
      if (idSource === "credit-limit-request") {
        const creditLimitRequest = await this.prisma.creditLimitChangeRequest.findUnique({
          where: { id: request.params.id },
        });
        if (!creditLimitRequest) {
          throw new NotFoundException(`Demande de hausse de limite de crédit ${request.params.id} introuvable`);
        }
        return creditLimitRequest.organizationId;
      }
      const invoice = await this.prisma.invoice.findUnique({ where: { id: request.params.id } });
      if (!invoice) {
        throw new NotFoundException(`Facture ${request.params.id} introuvable`);
      }
      return invoice.organizationId;
    }
    // Atteint uniquement en l'absence de params.id — une création (POST /invoices,
    // organizationId fait partie de CE QUI EST CRÉÉ, rien à usurper) ou une route
    // de liste (GET /invoices?organizationId=, aucune ressource pré-existante à
    // résoudre autrement que par le filtre explicitement demandé).
    if (request.body?.organizationId) {
      return request.body.organizationId;
    }
    if (request.query?.organizationId) {
      return request.query.organizationId;
    }
    throw new ForbiddenException("Impossible de déterminer l'organisation ciblée par cette requête");
  }
}
