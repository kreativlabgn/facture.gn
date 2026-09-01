import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@prisma/client";

// Validation RÉELLE de la garde d'identité de `bank_transaction` (rapprochement
// bancaire, ADR-052/ADR-117). Même posture que invoice-event-append-only : le
// trigger `bank_transaction_identity_immutable` s'applique à tout le monde (y
// compris le superuser CI), donc le test tourne dès qu'un Postgres migré est
// joignable (DATABASE_URL défini). Ignoré proprement en dev local sans Postgres.
const RUN = Boolean(process.env.DATABASE_URL);

(RUN ? describe : describe.skip)(
  "bank_transaction — colonnes d'identité immuables (Postgres réel, ADR-052/ADR-117)",
  () => {
    let prisma: PrismaClient;
    let organizationId: string;
    let userId: string;
    let transactionId: string;

    beforeAll(async () => {
      if (!RUN) return;
      prisma = new PrismaClient();
      const org = await prisma.organization.create({
        data: {
          name: "Bank Reco Org",
          regimeFiscal: "tpu",
          legalForm: "commercial",
          nif: `NIF-BR-${randomUUID()}`,
        },
      });
      organizationId = org.id;
      const user = await prisma.user.create({ data: { name: "Comptable interne" } });
      userId = user.id;
      const tx = await prisma.bankTransaction.create({
        data: {
          organizationId,
          importBatchId: randomUUID(),
          valueDate: new Date("2026-08-20"),
          amountCentimes: 1_500_000n,
          rawLabel: "VIR RECU / FG-2026-000042 / SARL DELTA",
          fingerprint: `fp-${randomUUID()}`,
          importedByUserId: userId,
        },
      });
      transactionId = tx.id;
    });

    afterAll(async () => {
      if (!RUN) return;
      // DELETE bloqué par le trigger → TRUNCATE (triggers ROW non déclenchés).
      await prisma.$executeRawUnsafe('TRUNCATE "bank_transaction"');
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.$disconnect();
    });

    it("autorise l'INSERT d'une transaction (import)", async () => {
      const inserted = await prisma.bankTransaction.findUnique({ where: { id: transactionId } });
      expect(inserted?.state).toBe("unmatched");
    });

    it("autorise un UPDATE des colonnes d'état (unmatched → ignored)", async () => {
      const resolved = await prisma.bankTransaction.update({
        where: { id: transactionId },
        data: { state: "ignored", resolvedByUserId: userId, resolvedAt: new Date() },
      });
      expect(resolved.state).toBe("ignored");
      // remise à l'état initial pour les tests suivants
      await prisma.$executeRawUnsafe(
        `UPDATE "bank_transaction" SET state = 'unmatched', resolved_by_user_id = NULL, resolved_at = NULL WHERE id = $1`,
        transactionId,
      );
    });

    it("refuse un UPDATE de amount_centimes (colonne d'identité)", async () => {
      await expect(
        prisma.bankTransaction.update({
          where: { id: transactionId },
          data: { amountCentimes: 9_999_999n },
        }),
      ).rejects.toThrow(/immuables/i);
    });

    it("refuse un UPDATE de raw_label (colonne d'identité)", async () => {
      await expect(
        prisma.bankTransaction.update({
          where: { id: transactionId },
          data: { rawLabel: "libellé maquillé" },
        }),
      ).rejects.toThrow(/immuables/i);
    });

    it("refuse un DELETE d'une transaction existante", async () => {
      await expect(
        prisma.bankTransaction.delete({ where: { id: transactionId } }),
      ).rejects.toThrow(/DELETE interdit/i);
      const stillThere = await prisma.bankTransaction.findUnique({ where: { id: transactionId } });
      expect(stillThere).not.toBeNull();
    });

    it("refuse un INSERT à montant négatif (CHECK bank_transaction_amount_positive)", async () => {
      await expect(
        prisma.bankTransaction.create({
          data: {
            organizationId,
            importBatchId: randomUUID(),
            valueDate: new Date("2026-08-21"),
            amountCentimes: -1_000n,
            rawLabel: "prélèvement (sortant)",
            fingerprint: `fp-neg-${randomUUID()}`,
            importedByUserId: userId,
          },
        }),
      ).rejects.toThrow();
    });
  },
);
