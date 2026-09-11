import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@facture-gn/db";

// ADR-107, tranche 3 — la série SÉQUENTIELLE DÉDIÉE au e-Reporting B2C.
//
// ── CE QU'ELLE N'EST PAS ─────────────────────────────────────────────────────
// Ce n'est PAS la numérotation légale. Un Z de caisse est une facture certifiée
// comme une autre : il consomme un numéro FG-YYYY-NNNNNN de la séquence Article
// 23 de son organisation, posé par InvoicesService.issue() via
// InvoiceNumberingService. Sortir tout un flux de cette séquence « sans trou »
// serait un arbitrage juridique, jamais un choix d'implémentation.
//
// Les deux numéros coexistent donc sur le même document et disent deux choses
// différentes :
//   • invoice.number                → identité fiscale, opposable, Article 23 ;
//   • invoice.reportingSeriesNumber → rang du Z dans la suite des Z de caisse de
//     l'organisation, celui que le contrôleur DGI rapproche des tickets.
//
// ── POURQUOI UN COMPTEUR SÉPARÉ, ET PAS UNE COLONNE DE PLUS SUR invoice_sequence
// invoice_sequence porte la séquence légale de TOUTES les factures. Y faire
// passer une seconde suite mêlerait, dans une même table, une numérotation
// opposable en contrôle fiscal et une numérotation de commodité — le premier
// écart entre les deux se paierait sur la mauvaise.

/** ZR-YYYY-NNNNNN. Même forme que formatInvoiceNumber (FG-YYYY-NNNNNN), préfixe
 *  distinct : à l'œil nu, un numéro de série e-Reporting ne peut pas être
 *  confondu avec un numéro légal, et l'inverse non plus. */
export function formatReportingSeriesNumber(year: number, lastNumber: number): string {
  if (!Number.isInteger(lastNumber) || lastNumber < 1) {
    throw new RangeError("lastNumber doit être un entier positif — jamais de ZR-YYYY-000000");
  }
  return `ZR-${year}-${String(lastNumber).padStart(6, "0")}`;
}

// AUCUN PrismaClient injecté, contrairement à InvoiceNumberingService : ce service
// n'écrit JAMAIS hors d'une transaction reçue (voir nextNumber ci-dessous). Lui
// donner un client global serait offrir la porte de sortie que la signature
// s'emploie précisément à fermer.
@Injectable()
export class PdpReportingNumberingService {
  /**
   * Rang suivant de la série e-Reporting de l'organisation pour l'année donnée.
   *
   * Upsert-incrément atomique en UNE instruction, copie conforme
   * d'InvoiceNumberingService.nextNumber() : le verrou de ligne posé par
   * ON CONFLICT DO UPDATE sérialise deux consolidations concurrentes sur
   * (organizationId, year). Deux runs ne peuvent pas rendre le même rang, et
   * aucun rang n'est sauté.
   *
   * `tx` N'EST PAS OPTIONNEL, contrairement à son jumeau — et cette divergence
   * est délibérée. InvoiceNumberingService doit rester appelable hors
   * transaction pour ses tests et ses appelants historiques ; ici il n'existe
   * qu'UN appelant, la transaction de création du brouillon Z, et il DOIT passer
   * son tx. Sans lui, ce $queryRaw partirait en autocommit sur le client global,
   * hors du rollback de la transaction englobante : un rang serait consommé de
   * façon irréversible alors même que le Z correspondant n'a jamais existé.
   * Exiger le paramètre rend la faute impossible plutôt que documentée.
   *
   * Le scope RLS est celui de la transaction reçue — setOrganizationScope a déjà
   * été appelé par l'appelant, en première ligne de son bloc. C'est ce qui
   * autorise ce SQL brut sous la politique org_isolation de
   * pdp_reporting_sequence (WITH CHECK sur organization_id).
   */
  async nextNumber(
    organizationId: string,
    year: number,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const rows = await tx.$queryRaw<{ last_number: number }[]>`
      INSERT INTO pdp_reporting_sequence (id, organization_id, year, last_number)
      VALUES (${randomUUID()}, ${organizationId}, ${year}, 1)
      ON CONFLICT (organization_id, year)
      DO UPDATE SET last_number = pdp_reporting_sequence.last_number + 1
      RETURNING last_number
    `;

    const lastNumber = rows[0]?.last_number;
    if (lastNumber === undefined) {
      // Sous RLS FORCÉE, un WITH CHECK refusé ne lève pas toujours : l'INSERT
      // peut simplement ne rien rendre. Un `undefined` silencieusement propagé
      // produirait « ZR-2026-undefined » sur une facture certifiée.
      throw new Error(
        "Échec de l'incrémentation atomique de la série e-Reporting — aucun rang rendu",
      );
    }

    return formatReportingSeriesNumber(year, lastNumber);
  }
}
