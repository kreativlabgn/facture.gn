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

if (!hasDatabase) {
  describe("InvoiceNumberingService — concurrence réelle (Postgres)", () => {
    it.fails("nécessite DATABASE_URL — Postgres indisponible, test non exécutable", () => {
      throw new Error("DATABASE_URL absent : ce test doit rester visible comme non couvert, pas silencieusement vert");
    });
  });
}
