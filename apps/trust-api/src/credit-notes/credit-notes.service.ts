import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { InvoiceStatus, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { CreateCreditNoteDto } from "./dto/create-credit-note.dto";

// ADR-040 : un avoir ne corrige qu'une VRAIE facture déjà émise — jamais un
// proforma/devis (encore un brouillon), jamais une facture déjà annulée.
// Quality Audit 2026-08-23, finding #12 — Set<InvoiceStatus> explicite, voir
// payments.service.ts::PAYABLE_STATUSES pour la justification complète.
const CREDITABLE_STATUSES = new Set<InvoiceStatus>(["issued", "partially_paid", "paid"] as const);

@Injectable()
export class CreditNotesService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // ADR-040, C7 — mécanisme de correction d'une facture déjà émise, jamais une
  // mutation directe (Invoice.totalTtc/amountDue/amountPaid ne sont JAMAIS
  // touchés ici) : même précédent que les arrhes (Payment.depositType="arrhes",
  // C5) — un document financier annexe reste dans un bucket séparé plutôt que de
  // muter silencieusement le solde d'une facture immuable.
  //
  // Limitation connue et acceptée (SHOULD, pas MUST) : la garde anti-sur-crédit
  // lit puis écrit sans verrou — deux créations d'avoir strictement concurrentes
  // sur la même ligne pourraient en théorie toutes deux passer la vérification.
  // Scénario rare (contrairement aux paiements cash concurrents), pas de
  // contrainte DB supplémentaire pour cette story.
  async create(invoiceId: string, dto: CreateCreditNoteDto) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { lines: true },
    });

    if (invoice.documentType !== "invoice") {
      throw new ConflictException(
        `Seule une facture peut recevoir un avoir (actuel : ${invoice.documentType})`,
      );
    }
    if (!CREDITABLE_STATUSES.has(invoice.status)) {
      throw new ConflictException(
        `Facture ${invoiceId} ne peut recevoir d'avoir depuis le statut ${invoice.status}`,
      );
    }

    // Une seule requête pour toutes les lignes demandées (pas de N+1).
    const alreadyCredited = await this.prisma.creditNoteLine.groupBy({
      by: ["invoiceLineId"],
      where: { invoiceLineId: { in: dto.lines.map((line) => line.invoiceLineId) } },
      _sum: { quantityReturned: true },
    });
    const alreadyCreditedByLine = new Map(
      alreadyCredited.map((group) => [group.invoiceLineId, group._sum.quantityReturned ?? 0]),
    );

    let amount = 0n;
    const lineData = dto.lines.map((requested) => {
      const invoiceLine = invoice.lines.find((line) => line.id === requested.invoiceLineId);
      if (!invoiceLine) {
        throw new ConflictException(
          `La ligne ${requested.invoiceLineId} n'appartient pas à la facture ${invoiceId}`,
        );
      }

      const alreadyReturned = alreadyCreditedByLine.get(requested.invoiceLineId) ?? 0;
      const remaining = invoiceLine.quantity - alreadyReturned;
      if (requested.quantityReturned > remaining) {
        throw new ConflictException(
          `Quantité à créditer (${requested.quantityReturned}) supérieure à la quantité encore créditable (${remaining}) pour la ligne ${requested.invoiceLineId}`,
        );
      }

      // amount calculé côté serveur — jamais une valeur de confiance externe
      // (même principe que taxRateBps, C4).
      amount += BigInt(requested.quantityReturned) * invoiceLine.unitPrice;

      return { invoiceLineId: requested.invoiceLineId, quantityReturned: requested.quantityReturned };
    });

    // Création imbriquée en une seule opération Prisma (atomique nativement),
    // même précédent que createDraft() — pas de $transaction explicite requise.
    return this.prisma.creditNote.create({
      data: {
        invoiceId,
        amount,
        refundMultiplier: dto.refundMultiplier,
        reason: dto.reason,
        lines: { create: lineData },
      },
      include: { lines: true },
    });
  }
}
