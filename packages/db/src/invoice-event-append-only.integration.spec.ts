import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@prisma/client";

// Validation RÉELLE de la garde append-only de `invoice_event` (J1, ADR-015).
// Contrairement à rls.integration.spec.ts, ce test n'exige PAS de rôle
// non-propriétaire : le trigger `invoice_event_append_only` s'applique à tout
// le monde, y compris au superuser `postgres` de la CI. Il tourne donc dès
// qu'un Postgres migré est joignable (DATABASE_URL défini) — le job `build` de
// la CI le couvre. En dev local sans Postgres, il est ignoré proprement.
const RUN = Boolean(process.env.DATABASE_URL);

(RUN ? describe : describe.skip)(
  "invoice_event — append-only (Postgres réel, ADR-015)",
  () => {
    let prisma: PrismaClient;
    let organizationId: string;
    let invoiceId: string;
    let eventId: string;

    beforeAll(async () => {
      if (!RUN) return;
      prisma = new PrismaClient();
      const org = await prisma.organization.create({
        data: {
          name: "Append-only Org",
          regimeFiscal: "tpu",
          legalForm: "commercial",
          nif: `NIF-AO-${randomUUID()}`,
        },
      });
      organizationId = org.id;
      const invoice = await prisma.invoice.create({ data: { organizationId } });
      invoiceId = invoice.id;
      const event = await prisma.invoiceEvent.create({
        data: { invoiceId, type: "payment_reminder_sent" },
      });
      eventId = event.id;
    });

    afterAll(async () => {
      if (!RUN) return;
      // TRUNCATE ne déclenche pas les triggers de niveau ligne → le nettoyage
      // reste possible malgré la garde append-only.
      await prisma.$executeRawUnsafe(
        'TRUNCATE "invoice_event", "invoice", "organization" RESTART IDENTITY CASCADE',
      );
      await prisma.$disconnect();
    });

    it("refuse un UPDATE sur une ligne invoice_event existante", async () => {
      await expect(
        prisma.invoiceEvent.update({
          where: { id: eventId },
          data: { type: "dispute_raised" },
        }),
      ).rejects.toThrow(/append-only/i);
    });

    it("refuse un DELETE sur une ligne invoice_event existante", async () => {
      await expect(
        prisma.invoiceEvent.delete({ where: { id: eventId } }),
      ).rejects.toThrow(/append-only/i);
      const stillThere = await prisma.invoiceEvent.findUnique({ where: { id: eventId } });
      expect(stillThere).not.toBeNull();
    });

    it("autorise toujours l'INSERT d'un nouvel événement (append)", async () => {
      const appended = await prisma.invoiceEvent.create({
        data: { invoiceId, type: "payment_link_generated" },
      });
      expect(appended.id).toBeTruthy();
      const count = await prisma.invoiceEvent.count({ where: { invoiceId } });
      expect(count).toBe(2);
    });
  },
);
