import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { z } from "zod";
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
  async create(organizationId: string, dto: CreateRecurringTemplateDto) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    return this.prisma.recurringInvoiceTemplate.create({
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
  async generate(templateId: string, requesterUserId: string) {
    const template = await this.prisma.recurringInvoiceTemplate.findUniqueOrThrow({
      where: { id: templateId },
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

    const organization = await this.prisma.organization.findUniqueOrThrow({
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
      await this.prisma.invoiceEvent.create({
        data: {
          invoiceId: invoice.id,
          type: "regime_change",
          actorId: requesterUserId,
          metadata: { previousRegime: template.lastKnownRegimeFiscal, newRegime: organization.regimeFiscal },
        },
      });
    }

    await this.prisma.recurringInvoiceTemplate.update({
      where: { id: templateId },
      data: { lastGeneratedAt: new Date(), lastKnownRegimeFiscal: organization.regimeFiscal },
    });

    return invoice;
  }
}
