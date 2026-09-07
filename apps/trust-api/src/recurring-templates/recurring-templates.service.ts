import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { z } from "zod";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { InvoicesService } from "../invoices/invoices.service";
import type { CreateRecurringTemplateDto } from "./dto/create-recurring-template.dto";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Revalidé à la LECTURE (generate()), pas seulement à l'écriture (create()) —
// dev-domain-model-reviewer (I1) : `lines` est un Json non typé une fois en
// base, rien ne garantit qu'un futur chemin d'écriture y insère la bonne
// forme. Un cast non sûr aurait fait planter generate() avec un TypeError
// opaque (ex. BigInt(undefined)) plutôt qu'une erreur de domaine claire.
const storedLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.string().regex(/^\d+$/),
  productId: z.string().uuid().optional(),
});

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
  // RLS (ADR-111 étape 1) — `recurring_invoice_template` porte organization_id
  // en direct (org_isolation). Aucune transaction dans ce module : create() est
  // une lecture puis une écriture, generate() délègue l'atomicité à
  // InvoicesService.createDraft(), qui pose déjà son propre scope.
  async create(organizationId: string, dto: CreateRecurringTemplateDto) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const organization = await scoped.organization.findFirstOrThrow({
      where: { id: organizationId },
    });

    return scoped.recurringInvoiceTemplate.create({
      data: {
        organizationId,
        customerId: dto.customerId,
        branchId: dto.branchId,
        // JSON.stringify ne sait pas sérialiser un bigint (colonne Json) —
        // unitPrice converti en string, reconverti en bigint par generate()
        // avant l'appel à InvoicesService.createDraft().
        lines: dto.lines.map((line) => ({ ...line, unitPrice: line.unitPrice.toString() })),
        discountPct: dto.discountPct,
        intervalDays: dto.intervalDays,
        lastGeneratedAt: null,
        lastKnownRegimeFiscal: organization.regimeFiscal,
      },
    });
  }

  // I1, ADR-056 — createDraft() (jamais dupliqué) recalcule le taux/régime
  // fiscal frais à chaque appel (C4) : "jamais figé sur le template" est
  // structurellement garanti sans rien construire de spécial ici.
  // `organizationId` vient du RolesGuard : la route porte
  // @OrganizationIdSource("recurring-template"), le guard a donc déjà résolu
  // l'organisation du modèle et vérifié l'appartenance — pas d'oracle sur le
  // *OrThrow ci-dessous, un id inconnu n'atteint jamais le service.
  async generate(templateId: string, requesterUserId: string, organizationId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const template = await scoped.recurringInvoiceTemplate.findFirstOrThrow({
      where: { id: templateId, organizationId },
    });

    // Garde contre une double génération pour la même période — pas une
    // transaction sérialisable (même proportionnalité que H1 : un dépassement
    // sous course concurrente est une facture en trop, jamais une corruption).
    if (template.lastGeneratedAt) {
      const nextEligibleAt = new Date(template.lastGeneratedAt.getTime() + template.intervalDays * ONE_DAY_MS);
      if (new Date() < nextEligibleAt) {
        throw new ConflictException(
          `Modèle ${templateId} déjà généré récemment — prochaine génération possible le ${nextEligibleAt.toISOString()}`,
        );
      }
    }

    const organization = await scoped.organization.findFirstOrThrow({
      where: { id: template.organizationId },
    });

    const parsedLines = z.array(storedLineSchema).safeParse(template.lines);
    if (!parsedLines.success) {
      throw new ConflictException(`Modèle ${templateId} contient des lignes corrompues — génération impossible`);
    }

    const lines = parsedLines.data.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: BigInt(line.unitPrice),
      productId: line.productId,
    }));

    const invoice = await this.invoicesService.createDraft(
      {
        organizationId: template.organizationId,
        documentType: "invoice",
        customerId: template.customerId ?? undefined,
        branchId: template.branchId ?? undefined,
        lines,
        discountPct: template.discountPct,
        // Lot C — RecurringInvoiceTemplate ne porte pas de contexte B2G ; les
        // factures générées sont "standard" (suivi possible : ajouter les
        // références au template, hors périmètre Lot C).
        cadreFacturation: "standard",
      },
      // Lot D — génération récurrente déclenchée via l'endpoint PWA
      // (POST /recurring-templates/:id/generate) : canal "pwa" explicite plutôt
      // que le défaut, pour lever l'ambiguïté "oubli vs. intention". Pas de
      // valeur "recurring" dédiée (mélangerait canal d'interface et mécanisme
      // de déclenchement — voir plan Lot D).
      "pwa",
    );

    // ADR-056 — "alerte, jamais un mur silencieux" : jamais bloquant, seulement
    // une trace de revue sur la facture nouvellement générée.
    if (template.lastKnownRegimeFiscal && template.lastKnownRegimeFiscal !== organization.regimeFiscal) {
      await scoped.invoiceEvent.create({
        data: {
          invoiceId: invoice.id,
          type: "regime_change",
          actorId: requesterUserId,
          metadata: { previousRegime: template.lastKnownRegimeFiscal, newRegime: organization.regimeFiscal },
        },
      });
    }

    // `update` exige un `where` unique : la lecture scopée du modèle en tête de
    // méthode est la barrière.
    await scoped.recurringInvoiceTemplate.update({
      where: { id: templateId },
      data: { lastGeneratedAt: new Date(), lastKnownRegimeFiscal: organization.regimeFiscal },
    });

    return invoice;
  }
}
