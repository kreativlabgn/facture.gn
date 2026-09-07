import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { computeSealHash } from "./fiscal-period-seal";
import { EtaxSyncService } from "../etax/etax-sync.service";

// Lot B, ADR-110 — arrêté des comptes OHADA. Les statuts "émis" comptent dans le
// sceau : draft/proforma/quote (jamais certifiés) sont exclus. voided est inclus
// (la facture a existé et porte un numéro de séquence légal — l'arrêté doit en
// garder la trace).
const SEALED_STATUSES = ["issued", "partially_paid", "paid", "voided"] as const;

@Injectable()
export class FiscalPeriodsService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly etaxSync: EtaxSyncService,
  ) {}

  async close(organizationId: string, year: number, closedByUserId: string) {
    const currentYear = new Date().getUTCFullYear();
    // Borne basse : facture.gn n'existe pas avant 2020 — un `year` absurde
    // (négatif, 4 chiffres improbables) n'a aucun sens comptable.
    if (year < 2020 || year > currentYear) {
      throw new ConflictException(
        `Année d'exercice invalide (${year}) — attendu entre 2020 et ${currentYear}`,
      );
    }

    // Bornes UTC (jamais l'heure locale du serveur) — cohérent avec
    // formatFecDate et le renderer PDF (Lot A), tous en getUTC*.
    const from = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
    const where = {
      organizationId,
      status: { in: [...SEALED_STATUSES] },
      issuedAt: { gte: from, lte: to },
    };

    const closing = await this.prisma.$transaction(async (tx) => {
      // GUC en première ligne : il couvre l'agrégat, la lecture de la dernière
      // facture et la création du sceau — les trois composantes du hash.
      await setOrganizationScope(tx, organizationId);

      const aggregate = await tx.invoice.aggregate({
        where,
        _sum: { totalHt: true, totalTva: true, totalTtc: true },
        _count: true,
      });
      const lastInvoice = await tx.invoice.findFirst({
        where,
        orderBy: { number: "desc" },
        select: { number: true, hash: true },
      });

      const totalHt = aggregate._sum.totalHt ?? 0n;
      const totalTva = aggregate._sum.totalTva ?? 0n;
      const totalTtc = aggregate._sum.totalTtc ?? 0n;
      const invoiceCount = aggregate._count;

      const sealHash = computeSealHash({
        organizationId,
        year,
        lastInvoiceNumber: lastInvoice?.number ?? null,
        lastInvoiceHash: lastInvoice?.hash ?? null,
        totalHt,
        totalTva,
        totalTtc,
        invoiceCount,
      });

      try {
        return await tx.fiscalPeriodClosing.create({
          data: {
            organizationId,
            year,
            lastInvoiceNumber: lastInvoice?.number ?? null,
            lastInvoiceHash: lastInvoice?.hash ?? null,
            totalHt,
            totalTva,
            totalTtc,
            invoiceCount,
            sealHash,
            closedByUserId,
          },
        });
      } catch (error) {
        if (isUniqueConstraintViolation(error, "year") || isUniqueConstraintViolation(error, "organization_id")) {
          throw new ConflictException(`L'exercice ${year} de cette organisation est déjà clos`);
        }
        throw error;
      }
    });

    // Chantier 5, étape 3 — télétransmission à eTax, APRÈS le commit et HORS
    // de la transaction, à dessein. Enfiler à l'intérieur poserait deux
    // problèmes : un Redis en panne ferait échouer et annuler une clôture
    // comptable pourtant valide, et un rollback tardif laisserait dans la file
    // un job déclarant à la DGI un exercice qui n'a finalement pas été clos.
    //
    // enqueueForClosing() ne lève jamais : la clôture est déjà acquise, elle
    // n'a pas à être défaite parce que la file est indisponible. Une clôture
    // non enfilée reste repérable par etax_submitted_at IS NULL.
    await this.etaxSync.enqueueForClosing(closing);

    return closing;
  }

  async listByOrganization(organizationId: string) {
    return organizationScopedClient(this.prisma, organizationId).fiscalPeriodClosing.findMany({
      where: { organizationId },
      orderBy: { year: "desc" },
    });
  }
}
