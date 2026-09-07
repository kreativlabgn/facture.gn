import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import type { CreateRefundDto } from "./dto/create-refund.dto";

// RLS (ADR-111 étape 1) — CARTE DU MODULE. `refund`, `credit_note` et
// `invoice_event` sont toutes trois sous org_isolation par INDIRECTION (politique
// via invoice_id) : aucune ne porte de colonne organization_id. La clause
// explicite prend donc la forme `invoice: { organizationId }` — c'est
// l'équivalent de la double clause pour ce type de table.
// `organizationId` vient du RolesGuard : la route porte
// @OrganizationIdSource("credit-note"), le guard a donc déjà résolu
// l'organisation de l'avoir et vérifié l'appartenance de l'appelant.
@Injectable()
export class RefundsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // ADR-063, C13 — "credit_note = document comptable. refund = mouvement d'argent."
  // payment_link_payout (Djomy Payout) est créé "pending" : aucune intégration
  // Money Context payout n'existe dans ce repo (V2, ADR-089) — pas d'exécution ni
  // de confirmation automatique. cash/bank_transfer/credit_on_account sont des
  // attestations immédiates du staff (même principe que recordCashPayment()/
  // recordBankTransferPayment(), C1/C3) : "completed" dès la création.
  //
  // Security Audit 2026-08-23, finding #2 — même pattern d'idempotence que
  // PaymentsService (Payment.idempotencyKey) : sans lui, deux requêtes concurrentes
  // (double clic, retry réseau) passaient toutes deux la garde anti-sur-remboursement
  // ci-dessous avant qu'aucune n'ait committé, produisant un sur-remboursement réel.
  async create(
    creditNoteId: string,
    dto: CreateRefundDto,
    actorId: string,
    idempotencyKey: string,
    organizationId: string,
  ) {
    const scoped = organizationScopedClient(this.prisma, organizationId);

    const existing = await scoped.refund.findFirst({
      where: { idempotencyKey, invoice: { organizationId } },
    });
    if (existing) {
      return existing;
    }

    // Pas d'oracle malgré le *OrThrow : RolesGuard a déjà résolu cet avoir via
    // @OrganizationIdSource("credit-note") (findUnique + 404 explicite) avant
    // d'entrer dans le service — un id inconnu n'atteint jamais cette ligne.
    const creditNote = await scoped.creditNote.findFirstOrThrow({
      where: { id: creditNoteId, invoice: { organizationId } },
    });

    // Garde anti-sur-remboursement — même précédent que la garde anti-sur-crédit
    // de CreditNoteLine (C7), scopée ici à un seul avoir (pas de groupBy requis).
    // Un refund "failed" (tentative ratée, ex. provider indisponible) ne compte
    // jamais dans le solde déjà remboursé — il reste retentable. Reste une garde
    // best-effort hors transaction : la contrainte unique sur idempotencyKey
    // ci-dessus protège contre le rejeu de LA MÊME requête, pas contre deux
    // remboursements DISTINCTS (idempotencyKey différentes) soumis en vraie
    // concurrence — hors scope de ce correctif (même limite assumée par
    // CreditNoteLine/C7, jugée acceptable par 2 revues précédentes).
    const alreadyRefunded = await scoped.refund.aggregate({
      _sum: { amount: true },
      where: { creditNoteId, status: { not: "failed" }, invoice: { organizationId } },
    });
    const remaining = creditNote.amount - (alreadyRefunded._sum.amount ?? 0n);
    if (dto.amount > remaining) {
      throw new ConflictException(
        `Montant à rembourser (${dto.amount}) supérieur au solde encore remboursable (${remaining}) de l'avoir ${creditNoteId}`,
      );
    }

    const isImmediatelyCompleted = dto.method !== "payment_link_payout";

    try {
      return await this.prisma.$transaction(async (tx) => {
        // GUC en première ligne : il couvre la création du remboursement et sa
        // trace d'audit.
        await setOrganizationScope(tx, organizationId);

        const refund = await tx.refund.create({
          data: {
            creditNoteId,
            invoiceId: creditNote.invoiceId,
            amount: dto.amount,
            method: dto.method,
            status: isImmediatelyCompleted ? "completed" : "pending",
            completedAt: isImmediatelyCompleted ? new Date() : null,
            idempotencyKey,
          },
        });

        await tx.invoiceEvent.create({
          data: {
            invoiceId: creditNote.invoiceId,
            type: "refund_issued",
            amount: dto.amount,
            actorId,
          },
        });

        return refund;
      });
    } catch (error) {
      // Course concurrente : deux requêtes avec la même Idempotency-Key arrivent en
      // parallèle, toutes deux passent le lookup initial avant que l'une des deux ne
      // committe — même pattern que PaymentsService.resolveIdempotencyRace().
      if (isUniqueConstraintViolation(error, "idempotency_key")) {
        const winner = await scoped.refund.findFirst({
          where: { idempotencyKey, invoice: { organizationId } },
        });
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }
}
