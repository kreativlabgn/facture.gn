import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { CERTIFICATION_SERVICE } from "../certification/certification.module";
import type { CertificationService } from "../certification/certification.service";
import { PaymentLinkClient } from "../money-client/payment-link-client";
import { InvoiceNumberingService } from "./invoice-numbering.service";
import type { CreateInvoiceDto } from "./dto/create-invoice.dto";

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly numbering: InvoiceNumberingService,
    @Inject(CERTIFICATION_SERVICE) private readonly certification: CertificationService,
    private readonly paymentLinkClient: PaymentLinkClient,
  ) {}

  async createDraft(dto: CreateInvoiceDto) {
    const totalTtc = dto.lines.reduce((sum, line) => sum + BigInt(line.quantity) * line.unitPrice, 0n);

    return this.prisma.invoice.create({
      data: {
        organizationId: dto.organizationId,
        documentType: dto.documentType,
        status: "draft",
        totalTtc,
        amountDue: totalTtc,
        lines: {
          create: dto.lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRateBps: line.taxRateBps ?? 0,
          })),
        },
      },
    });
  }

  // Une facture issued est immuable — toute correction passe par un avoir (DAT §5.4).
  async updateDraft(invoiceId: string, patch: Prisma.InvoiceUpdateInput) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (invoice.status !== "draft") {
      throw new ConflictException(
        "Une facture issued est immuable — toute correction passe par un avoir (credit_note)",
      );
    }
    return this.prisma.invoice.update({ where: { id: invoiceId }, data: patch });
  }

  async issue(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (invoice.status !== "draft") {
      throw new ConflictException(
        `Facture ${invoiceId} ne peut être émise depuis le statut ${invoice.status}`,
      );
    }

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: invoice.organizationId },
    });

    const issuedAt = new Date();
    const number = await this.numbering.nextNumber(invoice.organizationId, issuedAt.getFullYear());

    const previousInvoice = await this.prisma.invoice.findFirst({
      where: { organizationId: invoice.organizationId, status: { not: "draft" } },
      orderBy: { issuedAt: "desc" },
    });

    const certification = this.certification.certify({
      invoiceId: invoice.id,
      organizationNif: organization.nif,
      number,
      totalTtc: invoice.totalTtc,
      issuedAt: issuedAt.toISOString(),
      previousHash: previousInvoice?.hash ?? "GENESIS",
    });

    let issuedInvoice;
    try {
      issuedInvoice = await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          number,
          certificationId: certification.certificationId,
          hash: certification.hash,
          previousHash: certification.previousHash,
          signature: Buffer.from(certification.signature, "hex"),
          status: "issued",
          issuedAt,
          amountDue: invoice.totalTtc,
        },
      });
    } catch (error) {
      // Filet de sécurité : InvoiceNumberingService (upsert atomique par organisation/
      // année) ne devrait jamais produire ce conflit, mais un 409 explicite vaut mieux
      // qu'un 500 brut si la séquence dérivait un jour sous concurrence extrême.
      if (isUniqueConstraintViolation(error, "number")) {
        throw new ConflictException(
          `Le numéro ${number} existe déjà pour cette organisation — réémission impossible`,
        );
      }
      throw error;
    }

    // Meilleur effort, jamais couplé à la certification (déjà committée ci-dessus) :
    // DAT §12 fixe deux SLA distinctes ("Émission facture < 2s" / "Génération lien
    // de paiement < 3s") — une panne Money Context ne doit jamais faire échouer
    // l'émission (Parcours Fanta : cash et lien ne s'excluent jamais l'un l'autre ;
    // C18 permet de régénérer un lien absent plus tard).
    const paymentLink = await this.paymentLinkClient.tryGenerate({
      invoiceId: issuedInvoice.id,
      organizationId: issuedInvoice.organizationId,
      amountGnf: issuedInvoice.totalTtc,
    });
    if (!paymentLink) {
      return issuedInvoice;
    }

    // Même garantie que l'appel HTTP lui-même : un corps de réponse money-api
    // inattendu (ex. paymentLinkExpiresAt invalide) ne doit jamais faire échouer
    // une émission déjà certifiée et committée.
    try {
      return await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          paymentLinkUrl: paymentLink.paymentLinkUrl,
          paymentLinkId: paymentLink.providerRef,
          paymentLinkExpiresAt: paymentLink.expiresAt,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Facture ${invoiceId} certifiée mais l'enregistrement du lien de paiement a échoué : ${(error as Error).message}`,
      );
      return issuedInvoice;
    }
  }

  // voided réservé aux factures sans aucun paiement (PRD §4.2).
  async void(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

    if (invoice.amountPaid > 0n) {
      throw new ConflictException(
        "Une facture avec un paiement enregistré ne peut être annulée — utiliser un avoir",
      );
    }

    if (invoice.status !== "draft" && invoice.status !== "issued") {
      throw new ConflictException(`Facture ${invoiceId} ne peut être annulée depuis le statut ${invoice.status}`);
    }

    return this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: "voided" } });
  }
}
