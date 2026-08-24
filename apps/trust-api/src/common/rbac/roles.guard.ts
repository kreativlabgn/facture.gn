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
import { ORGANIZATION_ID_SOURCE_KEY, type OrganizationIdSourceValue } from "./organization-id-source.decorator";

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

    // Cross-Story Audit 2026-08-24, finding #1 CRITIQUE — un token
    // scope:"client_portal" (ClientPortalAuthService.verifyOtp(), OTP F13) ne
    // prouve qu'un contrôle du numéro de téléphone, jamais un mot de passe. Sans
    // ce rejet, un tel token passait cette garde exactement comme un token
    // login() de portée complète (même sub, RolesGuard résout le membership réel
    // de l'utilisateur), donnant à un attaquant ayant intercepté un SMS OTP
    // l'accès à TOUTE route @Roles() avec le rôle réel de la victime — pas
    // seulement le portail client. ClientPortalController/ClientPortalAuthController
    // ne déclarent justement aucun @Roles() (voir leur propre commentaire), donc ce
    // rejet ne les atteint jamais : elles restent protégées uniquement par
    // ClientPortalScopeGuard.
    if (request.user?.scope === "client_portal") {
      throw new ForbiddenException("Ce token (portail client) n'est pas autorisé sur cette route");
    }

    // Défaut "invoice" : rétrocompatible avec toutes les routes existantes qui ne
    // déclarent pas @OrganizationIdSource() (issue/void/...).
    const idSource =
      this.reflector.getAllAndOverride<OrganizationIdSourceValue | undefined>(ORGANIZATION_ID_SOURCE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? "invoice";

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
  // Quality Audit 2026-08-23, finding #11 — if-chain remplacée par un switch
  // exhaustif : un idSource ajouté à OrganizationIdSourceValue sans branche
  // correspondante ici est désormais une ERREUR DE COMPILATION (le `default`
  // ci-dessous assigne idSource à `never`, impossible si un cas est oublié),
  // jamais un silence à l'exécution retombant sur la résolution "invoice".
  private async resolveOrganizationId(request: any, idSource: OrganizationIdSourceValue): Promise<string> {
    if (request.params?.id) {
      // findUnique + 404 explicite plutôt que findUniqueOrThrow : une NotFoundError
      // Prisma non interceptée fuiterait en 500 brut plutôt qu'une réponse propre.
      switch (idSource) {
        case "organization": {
          const organization = await this.prisma.organization.findUnique({ where: { id: request.params.id } });
          if (!organization) {
            throw new NotFoundException(`Organisation ${request.params.id} introuvable`);
          }
          return organization.id;
        }
        case "credit-note": {
          const creditNote = await this.prisma.creditNote.findUnique({
            where: { id: request.params.id },
            include: { invoice: true },
          });
          if (!creditNote) {
            throw new NotFoundException(`Avoir ${request.params.id} introuvable`);
          }
          return creditNote.invoice.organizationId;
        }
        case "customer": {
          const customer = await this.prisma.customer.findUnique({ where: { id: request.params.id } });
          if (!customer) {
            throw new NotFoundException(`Client ${request.params.id} introuvable`);
          }
          return customer.organizationId;
        }
        case "branch": {
          const branch = await this.prisma.branch.findUnique({ where: { id: request.params.id } });
          if (!branch) {
            throw new NotFoundException(`Succursale ${request.params.id} introuvable`);
          }
          return branch.organizationId;
        }
        case "credit-limit-request": {
          const creditLimitRequest = await this.prisma.creditLimitChangeRequest.findUnique({
            where: { id: request.params.id },
          });
          if (!creditLimitRequest) {
            throw new NotFoundException(`Demande de hausse de limite de crédit ${request.params.id} introuvable`);
          }
          return creditLimitRequest.organizationId;
        }
        case "product": {
          const product = await this.prisma.product.findUnique({ where: { id: request.params.id } });
          if (!product) {
            throw new NotFoundException(`Produit ${request.params.id} introuvable`);
          }
          return product.organizationId;
        }
        case "recurring-template": {
          const template = await this.prisma.recurringInvoiceTemplate.findUnique({
            where: { id: request.params.id },
          });
          if (!template) {
            throw new NotFoundException(`Modèle récurrent ${request.params.id} introuvable`);
          }
          return template.organizationId;
        }
        case "invoice": {
          const invoice = await this.prisma.invoice.findUnique({ where: { id: request.params.id } });
          if (!invoice) {
            throw new NotFoundException(`Facture ${request.params.id} introuvable`);
          }
          return invoice.organizationId;
        }
        default: {
          const exhaustiveCheck: never = idSource;
          throw new Error(`OrganizationIdSourceValue non géré : ${exhaustiveCheck}`);
        }
      }
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
