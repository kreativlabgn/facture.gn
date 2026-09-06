import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { CUSTOMER_NAME_TOMBSTONE } from "./anonymization";
import { DataRightsService } from "./data-rights.service";
import { hashMsisdn } from "./subject-data";

const PEPPER = "a".repeat(64);
process.env.DATA_RIGHTS_SUBJECT_HASH_PEPPER = PEPPER; // lu par le constructeur du service

const PHONE = "+224620001122";
const HASH = hashMsisdn(PHONE, PEPPER);

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
    expect(JSON.stringify(result)).not.toContain("possibleDuplicateOf");
  });

  it("scope PME : filtre les clients sur l'organisation de l'appelant, JAMAIS de bloc compte User", async () => {
    const { service, prisma } = build({
      userPhone: {
        findFirst: vi.fn().mockResolvedValue({ user: { id: "usr-9", name: "X", preferredLanguage: "fr", phones: [] } }),
      },
    });

    const result = await service.exportSubjectData({ phone: PHONE, organizationId: "org-1" });

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ phone: PHONE, organizationId: "org-1" }) }),
    );
    // fuite inter-tenant fermée : le chemin PME n'interroge même pas UserPhone
    expect(prisma.userPhone.findFirst).not.toHaveBeenCalled();
    expect(result.account).toBeNull();
  });

  it("chemin PME : un numéro sans aucun client de l'organisation → 404, aucune ligne de registre", async () => {
    const { service, prisma } = build({ customer: { findMany: vi.fn().mockResolvedValue([]) } });

    await expect(service.exportSubjectData({ phone: PHONE, organizationId: "org-1" })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.dataRightsRequest.create).not.toHaveBeenCalled();
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
    expect(prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { phone: PHONE } }));
  });

  it("chemin ops : inclut le bloc compte pour un UserPhone VÉRIFIÉ — jamais passwordHash ni pinHash", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      user: {
        id: "usr-9",
        name: "Mamadou Bah",
        preferredLanguage: "fr",
        phones: [{ msisdn: PHONE }, { msisdn: "+224655000000" }],
      },
    });
    const { service } = build({ userPhone: { findFirst } });

    const result = await service.exportSubjectData({ phone: PHONE, organizationId: null });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { msisdn: PHONE, verifiedAt: { not: null } } }),
    );
    expect(result.account).toEqual({
      userId: "usr-9",
      name: "Mamadou Bah",
      preferredLanguage: "fr",
      phones: [PHONE, "+224655000000"],
    });
    expect(JSON.stringify(result)).not.toMatch(/argon2|passwordHash|pinHash|SECRET/i);
  });

  it("écrit une ligne de registre kind=access, outcome=completed, avec le HMAC du numéro", async () => {
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

  it("chemin ops : numéro introuvable → dossier vide mais une ligne de registre est quand même écrite", async () => {
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

  it("lève si le pepper du hash n'est pas configuré (jamais de hash faible)", async () => {
    const saved = process.env.DATA_RIGHTS_SUBJECT_HASH_PEPPER;
    delete process.env.DATA_RIGHTS_SUBJECT_HASH_PEPPER;
    try {
      const { service } = build();
      await expect(service.exportSubjectData({ phone: PHONE, organizationId: null })).rejects.toThrow(/pepper/i);
    } finally {
      process.env.DATA_RIGHTS_SUBJECT_HASH_PEPPER = saved;
    }
  });
});

// ── Anonymisation ──────────────────────────────────────────────────────────

function anonCustomer(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "cus-1",
    organizationId: "org-1",
    name: "Aïssatou Diallo",
    phone: PHONE,
    nif: "GN99887766",
    creditLimit: 500_000n,
    possibleDuplicateOf: "cus-0",
    anonymizedAt: null,
    invoices: [] as { documentType: string; status: string; issuedAt: Date | null }[],
    ...over,
  };
}

function buildAnon(
  customer: ReturnType<typeof anonCustomer>,
  opts: { fullRead?: ReturnType<typeof anonCustomer> } = {},
) {
  const full = opts.fullRead ?? customer;
  const tx: any = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    customer: {
      findUnique: vi.fn().mockResolvedValue({ organizationId: customer.organizationId, phone: customer.phone }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(full),
      update: vi.fn((args: any) => Promise.resolve({ ...full, ...args.data })),
    },
    dataRightsRequest: { create: vi.fn((args: any) => Promise.resolve({ id: "drr-1", ...args.data })) },
  };
  const prisma: any = {
    $transaction: vi.fn((cb: any) => cb(tx)),
    customer: { findMany: vi.fn().mockResolvedValue([{ id: customer.id }]) },
    dataRightsRequest: tx.dataRightsRequest,
  };
  const service = new DataRightsService(prisma as never);
  return { service, prisma, tx };
}

describe("DataRightsService.anonymizeCustomerById", () => {
  it("aucune facture conservée → anonymisation COMPLÈTE (name tombstone, phone/nif/creditLimit/dup nuls)", async () => {
    const { service, tx } = buildAnon(
      anonCustomer({ invoices: [{ documentType: "invoice", status: "draft", issuedAt: new Date() }] }),
    );

    const result = await service.anonymizeCustomerById("cus-1", { requestedByUserId: "usr-1", viaOps: false });

    expect(result.outcome).toBe("completed");
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: "cus-1" },
      data: expect.objectContaining({
        name: CUSTOMER_NAME_TOMBSTONE,
        phone: null,
        nif: null,
        creditLimit: null,
        possibleDuplicateOf: null,
        notificationChannel: "sms",
        anonymizedAt: expect.any(Date),
      }),
    });
  });

  it("≥1 facture issued → anonymisation PARTIELLE (name + nif conservés, contact effacé, échéance dans note)", async () => {
    const { service, tx } = buildAnon(
      anonCustomer({
        invoices: [{ documentType: "invoice", status: "issued", issuedAt: new Date("2027-01-05T09:00:00.000Z") }],
      }),
    );

    const result = await service.anonymizeCustomerById("cus-1", { requestedByUserId: "usr-1", viaOps: false });

    expect(result.outcome).toBe("partial");
    const updateData = tx.customer.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty("name");
    expect(updateData).not.toHaveProperty("nif");
    expect(updateData).toMatchObject({ phone: null, creditLimit: null, possibleDuplicateOf: null, anonymizedAt: expect.any(Date) });
    const drr = tx.dataRightsRequest.create.mock.calls[0][0].data;
    expect(drr).toMatchObject({ kind: "anonymization", outcome: "partial" });
    expect(drr.note).toContain("2037-01-05");
  });

  it("re-lecture sous verrou : si le client a été anonymisé entre-temps (course), 2ᵉ passage = no-op", async () => {
    // stub (avant verrou) = pas encore anonymisé ; re-lecture (sous verrou) = déjà anonymisé
    const { service, tx } = buildAnon(anonCustomer(), {
      fullRead: anonCustomer({ anonymizedAt: new Date("2026-08-01T00:00:00.000Z"), phone: null }),
    });

    const result = await service.anonymizeCustomerById("cus-1", { requestedByUserId: "usr-1", viaOps: false });

    expect(result.outcome).toBe("completed");
    expect(tx.customer.update).not.toHaveBeenCalled();
    const drr = tx.dataRightsRequest.create.mock.calls[0][0].data;
    expect(drr.note).toMatch(/rejeu no-op/i);
    expect(drr.subjectPhoneHash).toBeNull(); // plus de téléphone à hacher
  });

  it("prend le verrou consultatif AVANT la re-lecture du client et avant l'écriture", async () => {
    const { service, tx } = buildAnon(anonCustomer());

    await service.anonymizeCustomerById("cus-1", { requestedByUserId: "usr-1", viaOps: false });

    const lockOrder = tx.$executeRaw.mock.invocationCallOrder[0];
    const rereadOrder = tx.customer.findUniqueOrThrow.mock.invocationCallOrder[0];
    const updateOrder = tx.customer.update.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(rereadOrder);
    expect(rereadOrder).toBeLessThan(updateOrder);
  });

  it("client introuvable → NotFoundException (jamais un 200 avec outcome failed)", async () => {
    const { service, tx } = buildAnon(anonCustomer());
    tx.customer.findUnique.mockResolvedValue(null);

    await expect(
      service.anonymizeCustomerById("cus-404", { requestedByUserId: "usr-1", viaOps: false }),
    ).rejects.toThrow(NotFoundException);
  });

  it("registre : affectedCustomerIds contient l'id anonymisé + HMAC du téléphone", async () => {
    const { service, tx } = buildAnon(anonCustomer());

    await service.anonymizeCustomerById("cus-1", { requestedByUserId: "usr-1", viaOps: false });

    expect(tx.dataRightsRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        affectedCustomerIds: ["cus-1"],
        subjectPhoneHash: HASH,
        organizationId: "org-1",
        viaOps: false,
      }),
    });
  });
});

describe("DataRightsService.anonymizeSubjectByPhone (chemin ops, transverse)", () => {
  it("anonymise tous les clients du numéro et agrège en UN seul registre (partial si au moins un partiel)", async () => {
    const c1 = anonCustomer({ id: "cus-a", organizationId: "org-a", invoices: [] });
    const c2 = anonCustomer({
      id: "cus-b",
      organizationId: "org-b",
      invoices: [{ documentType: "invoice", status: "paid", issuedAt: new Date("2026-06-01T00:00:00.000Z") }],
    });
    const byId: Record<string, any> = { "cus-a": c1, "cus-b": c2 };
    const tx: any = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      customer: {
        findUnique: vi.fn((args: any) =>
          Promise.resolve({ organizationId: byId[args.where.id].organizationId, phone: byId[args.where.id].phone }),
        ),
        findUniqueOrThrow: vi.fn((args: any) => Promise.resolve(byId[args.where.id])),
        update: vi.fn((args: any) => Promise.resolve({ ...args.data })),
      },
      dataRightsRequest: { create: vi.fn((args: any) => Promise.resolve({ id: "drr", ...args.data })) },
    };
    const prisma: any = {
      $transaction: vi.fn((cb: any) => cb(tx)),
      customer: { findMany: vi.fn().mockResolvedValue([{ id: "cus-a" }, { id: "cus-b" }]) },
    };
    const service = new DataRightsService(prisma as never);

    const result = await service.anonymizeSubjectByPhone({ phone: PHONE, organizationId: null });

    expect(result.outcome).toBe("partial");
    expect(result.affectedCustomerIds.sort()).toEqual(["cus-a", "cus-b"]);
    expect(tx.dataRightsRequest.create).toHaveBeenCalledTimes(1);
    expect(tx.dataRightsRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "anonymization",
        outcome: "partial",
        subjectPhoneHash: HASH,
        affectedCustomerIds: expect.arrayContaining(["cus-a", "cus-b"]),
        viaOps: true,
        organizationId: null,
      }),
    });
  });
});
