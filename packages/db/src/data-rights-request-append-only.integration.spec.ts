import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@prisma/client";

// Validation RÉELLE de la garde append-only de `data_rights_request` (J2,
// ADR-116). Même posture que invoice-event-append-only.integration.spec.ts : le
// trigger `data_rights_request_append_only` s'applique à tout le monde, y
// compris au superuser `postgres` de la CI. Tourne dès qu'un Postgres migré est
// joignable (DATABASE_URL défini) ; ignoré proprement en dev local sans Postgres.
const RUN = Boolean(process.env.DATABASE_URL);

(RUN ? describe : describe.skip)(
  "data_rights_request — append-only (Postgres réel, ADR-116)",
  () => {
    let prisma: PrismaClient;
    let requestId: string;

    beforeAll(async () => {
      if (!RUN) return;
      prisma = new PrismaClient();
      const created = await prisma.dataRightsRequest.create({
        data: {
          kind: "access",
          outcome: "completed",
          subjectPhoneHash: createHash("sha256").update(`+224620${randomUUID()}`).digest("hex"),
          viaOps: true,
          affectedCustomerIds: [],
        },
      });
      requestId = created.id;
    });

    afterAll(async () => {
      if (!RUN) return;
      // DELETE bloqué par la garde → TRUNCATE (trigger de niveau ligne ne s'y
      // déclenche pas ; aucune table ne référence data_rights_request).
      await prisma.$executeRawUnsafe('TRUNCATE "data_rights_request"');
      await prisma.$disconnect();
    });

    it("refuse un UPDATE sur une ligne data_rights_request existante", async () => {
      await expect(
        prisma.dataRightsRequest.update({
          where: { id: requestId },
          data: { note: "tentative de réécriture" },
        }),
      ).rejects.toThrow(/append-only/i);
    });

    it("refuse un DELETE sur une ligne data_rights_request existante", async () => {
      await expect(
        prisma.dataRightsRequest.delete({ where: { id: requestId } }),
      ).rejects.toThrow(/append-only/i);
      const stillThere = await prisma.dataRightsRequest.findUnique({ where: { id: requestId } });
      expect(stillThere).not.toBeNull();
    });

    it("autorise toujours l'INSERT d'une nouvelle demande (append)", async () => {
      const appended = await prisma.dataRightsRequest.create({
        data: {
          kind: "anonymization",
          outcome: "partial",
          subjectPhoneHash: createHash("sha256").update("+224621002233").digest("hex"),
          affectedCustomerIds: [randomUUID()],
          note: "name/nif conservés jusqu'à 2036-08-31T00:00:00.000Z",
        },
      });
      expect(appended.id).toBeTruthy();
      const count = await prisma.dataRightsRequest.count();
      expect(count).toBe(2);
    });
  },
);
