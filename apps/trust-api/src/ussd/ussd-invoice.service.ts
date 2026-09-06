import { Inject, Injectable } from "@nestjs/common";
import type { InvoiceCadre, OrganizationRole, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { OrganizationsService } from "../organizations/organizations.service";
import { InvoicesService } from "../invoices/invoices.service";
import { VelocityTierService } from "./velocity-tier.service";
import { MAX_RESULTS } from "./ussd-invoice-list.service";

// Même trio que POST /invoices (invoices.controller.ts) — cet appel bypasse
// RolesGuard (appel direct service à service, jamais passé par le contrôleur
// HTTP), le contrôle de rôle est donc reconstruit explicitement ici.
const EMIT_ELIGIBLE_ROLES: OrganizationRole[] = ["owner", "admin", "accountant_internal", "cashier", "field_agent"];

// D1, §2.4 Spec USSD — aucune nouvelle logique de facturation : délègue
// entièrement à InvoicesService (createDraft+issue, déjà signature serveur
// immédiate A3 + notification SMS/WhatsApp automatique C9 dès qu'un
// customerId est attaché).
@Injectable()
export class UssdInvoiceService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly organizationsService: OrganizationsService,
    private readonly invoicesService: InvoicesService,
    private readonly velocityTier: VelocityTierService,
  ) {}

  // organizationIdHint : déjà résolu et validé par le chemin "code compte"
  // (§3.2 — le compte identifie directement une organisation), utilisé tel
  // quel. Sinon (téléphone reconnu, §3.1, potentiellement plusieurs
  // organisations), résout via le premier membership habilité à émettre.
  async resolveOrganizationForEmission(userId: string, organizationIdHint?: string): Promise<string | null> {
    if (organizationIdHint) {
      return organizationIdHint;
    }

    const memberships = await this.organizationsService.listMine(userId);
    const eligible = memberships.find((membership: { role: OrganizationRole }) =>
      EMIT_ELIGIBLE_ROLES.includes(membership.role),
    );
    return eligible?.id ?? null;
  }

  // undefined si aucun téléphone saisi (§2.4 — "si numéro renseigné", jamais
  // un client inventé). name: phone, faute de nom collecté par ce canal.
  async resolveOrCreateCustomer(organizationId: string, phone: string | undefined): Promise<string | undefined> {
    if (!phone) {
      return undefined;
    }

    const existing = await this.prisma.customer.findFirst({ where: { organizationId, phone } });
    if (existing) {
      return existing.id;
    }

    const created = await this.prisma.customer.create({ data: { organizationId, name: phone, phone } });
    return created.id;
  }

  // amountCentimes : centimes GNF (convention repo), pas des GNF naturels —
  // la conversion ×100 se fait à la lecture de la saisie utilisateur, jamais
  // ici (même discipline que InvoiceForm.tsx côté web).
  // referenceMarche : K3, §2.6.1 Spec USSD, ADR-090 — optionnel, recopié tel
  // quel, jamais vérifié. Option 6 réutilise ce même chemin d'émission que
  // l'Option 4, jamais un second chemin parallèle.
  async emitInvoice(
    organizationId: string,
    amountCentimes: bigint,
    customerId: string | undefined,
    referenceMarche?: string,
    // Lot C — Option 6 "Commande Publique" passe "marche_public" ; Option 4
    // (vente ordinaire) garde le défaut. Jamais dérivé de referenceMarche
    // (optionnel même en marche_public, ADR-090).
    cadreFacturation: InvoiceCadre = "standard",
  ) {
    // D4, §2.4 Spec USSD — "plafonds velocity_tier vérifiés avant confirmation",
    // toujours avant toute création (jamais un brouillon abandonné en base).
    await this.velocityTier.assertWithinLimits(organizationId, amountCentimes);

    const draft = await this.invoicesService.createDraft(
      {
        organizationId,
        documentType: "invoice",
        customerId,
        lines: [{ description: "Vente USSD", quantity: 1, unitPrice: amountCentimes }],
        discountPct: 0,
        referenceMarche,
        cadreFacturation,
      },
      // Lot D — canal *620#. Posé ici, jamais dans le DTO.
      "ussd",
    );
    // Hors HTTP : aucun RolesGuard ne tourne ici, donc aucune organisation
    // n'est résolue pour nous. Elle vient du paramètre d'emitInvoice(), lui-même
    // issu de la session USSD authentifiée — c'est la source de scope de ce flux.
    return this.invoicesService.issue(draft.id, organizationId);
  }

  // K3, §2.6.1 Spec USSD, décision 1 du plan — Option 6 sélectionne parmi les
  // clients DÉJÀ marqués isPublicEntity (F16, ADR-105, action PWA réservée
  // admin/owner) : la session condensée USSD (<90s) ne crée jamais ce
  // rattachement elle-même (flagPublicEntity() est explicitement hors
  // périmètre USSD, §6 Spec USSD — "aucune n'a de sens sur un menu texte à
  // profondeur limitée"). Plafonné comme les autres listes USSD (canal texte
  // contraint) — une PME a rarement plus de quelques administrations clientes.
  async listPublicEntityCustomers(organizationId: string) {
    return this.prisma.customer.findMany({
      where: { organizationId, isPublicEntity: true },
      orderBy: { createdAt: "asc" },
      take: MAX_RESULTS,
    });
  }
}
