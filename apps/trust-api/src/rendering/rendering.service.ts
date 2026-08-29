import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { untdidTypeCode } from "../invoices/untdid";
import { legalMentionsFor } from "./legal-mentions";
import { buildVerificationQrDataUrl, verificationUrl } from "./verification-qr";
import {
  buildInvoiceDocDefinition,
  buildReceiptDocDefinition,
  type InvoiceRenderInput,
  type ReceiptRenderInput,
} from "./document-renderer";
import { renderToBuffer } from "./pdf-printer";

export interface RenderedPdf {
  pdf: Buffer;
  // Nom de fichier lisible proposé au téléchargement (jamais l'UUID interne).
  filename: string;
}

// Lot C — assemble le bloc "Références" du PDF à partir des seules références
// B2G renseignées ET non vides ("" transportée telle quelle par le DTO,
// discipline ADR-090 — jamais une ligne "Label : " vide). Pur, testable.
export function b2gReferencesFrom(invoice: {
  referenceMarche: string | null;
  numeroBonCommande: string | null;
  numeroContrat: string | null;
  numeroEngagement: string | null;
}): { label: string; value: string }[] {
  return [
    { label: "Référence marché", value: invoice.referenceMarche },
    { label: "Bon de commande", value: invoice.numeroBonCommande },
    { label: "N° de contrat", value: invoice.numeroContrat },
    { label: "N° d'engagement", value: invoice.numeroEngagement },
  ].filter((ref): ref is { label: string; value: string } => ref.value != null && ref.value !== "");
}

// Orchestration de la couche restitution : charge les données via Prisma, vérifie
// les invariants (facture certifiée, paiement finalisé, cohérence facture↔paiement
// contre l'IDOR), délègue au renderer PUR. Aucune logique de calcul ici — les
// totaux affichés sont ceux déjà figés sur la facture émise (immuable).
//
// Le contrôle d'accès organisationnel est fait EN AMONT par RolesGuard
// (idSource "invoice") sur les routes ; ce service ne re-vérifie que la
// cohérence facture↔paiement.
@Injectable()
export class RenderingService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async renderInvoicePdf(invoiceId: string): Promise<RenderedPdf> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { organization: true, customer: true, lines: true },
    });
    if (!invoice) {
      throw new NotFoundException(`Facture ${invoiceId} introuvable`);
    }
    if (invoice.documentType !== "invoice" || !invoice.certificationId || !invoice.number || !invoice.issuedAt) {
      throw new ConflictException(
        "Aucun PDF disponible : ce document n'est pas une facture émise et certifiée",
      );
    }

    const input: InvoiceRenderInput = {
      organization: {
        name: invoice.organization.name,
        nif: invoice.organization.nif,
        rccm: invoice.organization.rccm,
      },
      customer: invoice.customer
        ? { name: invoice.customer.name, phone: invoice.customer.phone, nif: invoice.customer.nif }
        : null,
      number: invoice.number,
      issuedAt: invoice.issuedAt,
      certificationId: invoice.certificationId,
      status: invoice.status,
      discountPct: invoice.discountPct,
      lines: invoice.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
      totalHt: invoice.totalHt,
      totalTva: invoice.totalTva,
      totalTtc: invoice.totalTtc,
      legalMentions: legalMentionsFor(invoice.organization.regimeFiscal),
      verificationUrl: verificationUrl(invoice.certificationId),
      qrDataUrl: await buildVerificationQrDataUrl(invoice.certificationId),
      // Lot C — EN 16931 / B2G. Le bloc de références est assemblé ici (seules
      // les valeurs non-nulles), le renderer ne voit jamais les champs bruts.
      untdidTypeCode: untdidTypeCode(invoice.documentType),
      b2gReferences: b2gReferencesFrom(invoice),
    };

    return {
      pdf: await renderToBuffer(buildInvoiceDocDefinition(input)),
      filename: `facture-${invoice.number}.pdf`,
    };
  }

  async renderReceiptPdf(invoiceId: string, paymentId: string): Promise<RenderedPdf> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { organization: true },
    });
    if (!invoice) {
      throw new NotFoundException(`Facture ${invoiceId} introuvable`);
    }

    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    // IDOR : RolesGuard a vérifié l'organisation via l':id facture, jamais que le
    // paiement appartient à CETTE facture. Un 404 (pas un 403) : on ne révèle pas
    // l'existence d'un paiement d'une autre facture.
    if (!payment || payment.invoiceId !== invoiceId) {
      throw new NotFoundException(`Paiement ${paymentId} introuvable pour la facture ${invoiceId}`);
    }
    if (payment.status !== "completed") {
      throw new ConflictException(
        `Aucun reçu : le paiement ${paymentId} n'est pas finalisé (statut ${payment.status})`,
      );
    }
    if (!invoice.certificationId || !invoice.number) {
      throw new ConflictException("Aucun reçu : la facture associée n'est pas émise");
    }

    const input: ReceiptRenderInput = {
      invoiceNumber: invoice.number,
      certificationId: invoice.certificationId,
      organizationName: invoice.organization.name,
      payment: {
        method: payment.method,
        depositType: payment.depositType,
        amount: payment.amount,
        amountCollected: payment.amountCollected,
        platformFeeAmount: payment.platformFeeAmount,
        gatewayFeeAmount: payment.gatewayFeeAmount,
        providerRef: payment.providerRef,
        providerSubMethod: payment.providerSubMethod,
        collectedAt: payment.collectedAt,
      },
      invoiceAfter: {
        amountPaid: invoice.amountPaid,
        amountDue: invoice.amountDue,
        totalTtc: invoice.totalTtc,
      },
      verificationUrl: verificationUrl(invoice.certificationId),
      qrDataUrl: await buildVerificationQrDataUrl(invoice.certificationId),
    };

    return {
      pdf: await renderToBuffer(buildReceiptDocDefinition(input)),
      filename: `recu-${invoice.number}-${paymentId}.pdf`,
    };
  }
}
