import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";

// FG-YYYY-NNNNNN — séquentiel légal OHADA Article 23, sans trou, par organisation/année.
export function formatInvoiceNumber(year: number, lastNumber: number): string {
  if (!Number.isInteger(lastNumber) || lastNumber < 1) {
    throw new RangeError("lastNumber doit être un entier positif — jamais de FG-YYYY-000000");
  }
  return `FG-${year}-${String(lastNumber).padStart(6, "0")}`;
}

@Injectable()
export class InvoiceNumberingService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // Upsert-incrément atomique en une seule instruction SQL : le verrou de ligne posé
  // par ON CONFLICT DO UPDATE sérialise les émissions concurrentes sur (organizationId, year),
  // garantissant l'absence de trou et de doublon (Article 23 OHADA).
  async nextNumber(organizationId: string, year: number): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ last_number: number }[]>`
      INSERT INTO invoice_sequence (id, organization_id, year, last_number)
      VALUES (${randomUUID()}, ${organizationId}, ${year}, 1)
      ON CONFLICT (organization_id, year)
      DO UPDATE SET last_number = invoice_sequence.last_number + 1
      RETURNING last_number
    `;

    const lastNumber = rows[0]?.last_number;
    if (lastNumber === undefined) {
      throw new Error("Échec de l'incrémentation atomique de la séquence de numérotation");
    }

    return formatInvoiceNumber(year, lastNumber);
  }
}
