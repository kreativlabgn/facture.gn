import { describe, expect, it, vi } from "vitest";

import { DataRightsService } from "./data-rights.service";
import { hashMsisdn } from "./subject-data";

const PHONE = "+224620001122";
const HASH = hashMsisdn(PHONE);

function customerRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "cus-1",
    organizationId: "org-1",
    name: "Aïssatou Diallo",
    phone: PHONE,
    nif: null,
    creditLimit: null,
    possibleDuplicateOf: null,
    notificationChannel: "sms",
    anonymizedAt: null,
    createdAt: new Date("2026-02-01T08:00:00.000Z"),
    invoices: [
      {
        number: "FG-2026-000042",
        certificationId: "GN-12345678-2026-ABCDEF",
        documentType: "invoice",
        status: "paid",
        disputeStatus: "none",
        issuedAt: new Date("2026-03-10T10:00:00.000Z"),
        totalTtc: 1_500_000n,
      },
    ],
    ...over,
  };
}

function build(over: Partial<Record<string, any>> = {}) {
  const prisma: any = {
    customer: { findMany: vi.fn().mockResolvedValue([customerRow()]) },
    userPhone: { findFirst: vi.fn().mockResolvedValue(null) },
    dataRightsRequest: { create: vi.fn((args: any) => Promise.resolve({ id: "drr-1", ...args.data })) },
    ...over,
  };
  const service = new DataRightsService(prisma as never);
  return { service, prisma };
}

describe("DataRightsService.exportSubjectData", () => {
  it("assemble le dossier d'un client : ses champs + ses factures en métadonnées (jamais les lignes)", async () => {
    const { service } = build();

    const result = await service.exportSubjectData({ phone: "224 620 00 11 22", organizationId: "org-1" });

    expect(result.subjectPhoneHash).toBe(HASH);
    expect(result.scope).toBe("organization");
    expect(result.customers).toHaveLength(1);
    const c = result.customers[0];
    expect(c).toMatchObject({ customerId: "cus-1", name: "Aïssatou Diallo", phone: PHONE });
    expect(c.invoices[0]).toEqual({
      number: "FG-2026-000042",
      certificationId: "GN-12345678-2026-ABCDEF",
      documentType: "invoice",
      status: "paid",
      disputeStatus: "none",
      issuedAt: "2026-03-10T10:00:00.000Z",
      totalTtc: "1500000",
    });
    // aucune fuite de la structure interne / des lignes de facture
    expect(JSON.stringify(result)).not.toContain("possibleDuplicateOf");
    expect(JSON.stringify(result)).not.toContain("invoiceLine");
  });

  it("scope PME : filtre les clients sur l'organisation de l'appelant", async () => {
    const { service, prisma } = build();

    await service.exportSubjectData({ phone: PHONE, organizationId: "org-1" });

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ phone: PHONE, organizationId: "org-1" }) }),
    );
  });

  it("scope ops : organizationId null → aucun filtre d'organisation, scope 'platform'", async () => {
    const { service, prisma } = build({
      customer: {
        findMany: vi.fn().mockResolvedValue([customerRow(), customerRow({ id: "cus-2", organizationId: "org-2" })]),
      },
    });

    const result = await service.exportSubjectData({ phone: PHONE, organizationId: null });

    expect(result.scope).toBe("platform");
    expect(result.customers).toHaveLength(2);
    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone: PHONE } }),
    );
  });

  it("inclut le bloc compte si le numéro correspond à un UserPhone — jamais passwordHash ni pinHash", async () => {
    const { service } = build({
      userPhone: {
        findFirst: vi.fn().mockResolvedValue({
          user: {
            id: "usr-9",
            name: "Mamadou Bah",
            preferredLanguage: "fr",
            passwordHash: "$argon2id$SECRET",
            pinHash: "$argon2id$SECRET",
            phones: [{ msisdn: PHONE }, { msisdn: "+224655000000" }],
          },
        }),
      },
    });

    const result = await service.exportSubjectData({ phone: PHONE, organizationId: null });

    expect(result.account).toEqual({
      userId: "usr-9",
      name: "Mamadou Bah",
      preferredLanguage: "fr",
      phones: [PHONE, "+224655000000"],
    });
    expect(JSON.stringify(result)).not.toMatch(/argon2|passwordHash|pinHash|SECRET/i);
  });

  it("écrit une ligne de registre kind=access, outcome=completed, avec le hash du numéro", async () => {
    const { service, prisma } = build();

    await service.exportSubjectData({ phone: PHONE, organizationId: "org-1", requestedByUserId: "usr-1" });

    expect(prisma.dataRightsRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "access",
        outcome: "completed",
        subjectPhoneHash: HASH,
        requestedByUserId: "usr-1",
        viaOps: false,
        organizationId: "org-1",
        affectedCustomerIds: ["cus-1"],
      }),
    });
  });

  it("chemin ops : viaOps=true, requestedByUserId=null, organizationId=null dans le registre", async () => {
    const { service, prisma } = build();

    await service.exportSubjectData({ phone: PHONE, organizationId: null });

    expect(prisma.dataRightsRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ viaOps: true, requestedByUserId: null, organizationId: null }),
    });
  });

  it("numéro introuvable : dossier vide mais une ligne de registre est quand même écrite", async () => {
    const { service, prisma } = build({ customer: { findMany: vi.fn().mockResolvedValue([]) } });

    const result = await service.exportSubjectData({ phone: PHONE, organizationId: null });

    expect(result.customers).toHaveLength(0);
    expect(result.account).toBeNull();
    expect(prisma.dataRightsRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "access", outcome: "completed", affectedCustomerIds: [] }),
    });
  });

  it("rejette un numéro mal formé avant toute requête", async () => {
    const { service, prisma } = build();

    await expect(service.exportSubjectData({ phone: "pas-un-numero", organizationId: null })).rejects.toThrow(
      /numéro/i,
    );
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
    expect(prisma.dataRightsRequest.create).not.toHaveBeenCalled();
  });
});
