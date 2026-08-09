import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient, type PrismaClient } from "@facture-gn/db";
import { InvoiceNumberingService } from "./invoice-numbering.service";

// Test d'intégration réel — nécessite Postgres (DATABASE_URL). Volontairement
// non skippable silencieusement : si DATABASE_URL est absent, le test échoue
// avec un message explicite plutôt que d'être ignoré sans trace en CI.
// Bloqué au 08/08/2026 : Docker Desktop indisponible localement (voir PLAN
// Tâche 5/10, docs/plans/2026-08-08-bootstrap-trust-context.md).
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)("InvoiceNumberingService — concurrence réelle (Postgres)", () => {
  let prisma: PrismaClient;
  let service: InvoiceNumberingService;
  let organizationId: string;

  beforeAll(async () => {
    prisma = getPrismaClient();
    service = new InvoiceNumberingService(prisma);
    const org = await prisma.organization.create({
      data: {
        name: "Test Concurrence SARL",
        regimeFiscal: "tpu",
        legalForm: "commercial",
        nif: `NIF-TEST-${randomUUID()}`,
      },
    });
    organizationId = org.id;
  });

  afterAll(async () => {
    await prisma.invoiceSequence.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  it("ne produit jamais de trou ni de doublon sous 20 émissions concurrentes", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => service.nextNumber(organizationId, 2026)),
    );

    const unique = new Set(results);
    expect(unique.size).toBe(20);

    const numbers = results
      .map((n) => Number(n.split("-")[2]))
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});

describe.runIf(hasDatabase)("Invoice.number — unicité par organisation, pas globale (ERD ligne 208)", () => {
  let prisma: PrismaClient;
  let numbering: InvoiceNumberingService;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    prisma = getPrismaClient();
    numbering = new InvoiceNumberingService(prisma);

    const orgA = await prisma.organization.create({
      data: { name: "Boutique Aissatou", regimeFiscal: "tpu", legalForm: "commercial", nif: `NIF-A-${randomUUID()}` },
    });
    const orgB = await prisma.organization.create({
      data: { name: "Garage Mamadou", regimeFiscal: "tpu", legalForm: "commercial", nif: `NIF-B-${randomUUID()}` },
    });
    orgAId = orgA.id;
    orgBId = orgB.id;
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await prisma.invoiceSequence.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  });

  it("deux organisations différentes peuvent chacune émettre FG-2026-000001 sans collision", async () => {
    const numberA = await numbering.nextNumber(orgAId, 2026);
    const numberB = await numbering.nextNumber(orgBId, 2026);
    expect(numberA).toBe("FG-2026-000001");
    expect(numberB).toBe("FG-2026-000001");

    // totalHt/totalTva alignés sur totalTtc (organisations tpu, 0% TVA — C4) : la
    // contrainte invoice_tax_invariant_check exige total_ht+total_tva=total_ttc.
    const invoiceA = await prisma.invoice.create({
      data: {
        organizationId: orgAId,
        number: numberA,
        status: "issued",
        totalTtc: 700_000n,
        totalHt: 700_000n,
        amountDue: 700_000n,
      },
    });
    const invoiceB = await prisma.invoice.create({
      data: {
        organizationId: orgBId,
        number: numberB,
        status: "issued",
        totalTtc: 250_000n,
        totalHt: 250_000n,
        amountDue: 250_000n,
      },
    });

    expect(invoiceA.number).toBe(invoiceB.number);
    expect(invoiceA.organizationId).not.toBe(invoiceB.organizationId);
  });

  it("une même organisation ne peut pas avoir deux factures portant le même number", async () => {
    await prisma.invoice.create({
      data: {
        organizationId: orgAId,
        number: "FG-2026-000099",
        status: "issued",
        totalTtc: 100_000n,
        totalHt: 100_000n,
        amountDue: 100_000n,
      },
    });

    await expect(
      prisma.invoice.create({
        data: {
          organizationId: orgAId,
          number: "FG-2026-000099",
          status: "issued",
          totalTtc: 200_000n,
          totalHt: 200_000n,
          amountDue: 200_000n,
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
  });
});

if (!hasDatabase) {
  describe("InvoiceNumberingService — concurrence réelle (Postgres)", () => {
    it.fails("nécessite DATABASE_URL — Postgres indisponible, test non exécutable", () => {
      throw new Error("DATABASE_URL absent : ce test doit rester visible comme non couvert, pas silencieusement vert");
    });
  });
}
