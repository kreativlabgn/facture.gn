import { describe, expect, it, vi } from "vitest";

import { CUSTOMER_NAME_TOMBSTONE } from "./anonymization";
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

function buildAnon(customer: ReturnType<typeof anonCustomer>) {
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: "" }]),
    customer: {
      findUnique: vi.fn().mockResolvedValue(customer),
      update: vi.fn((args: any) => Promise.resolve({ ...customer, ...args.data })),
    },
    dataRightsRequest: { create: vi.fn((args: any) => Promise.resolve({ id: "drr-1", ...args.data })) },
  };
  const prisma: any = {
    $transaction: vi.fn((cb: any) => cb(tx)),
    customer: { findMany: vi.fn().mockResolvedValue([customer]) },
    dataRightsRequest: tx.dataRightsRequest,
  };
  const service = new DataRightsService(prisma as never);
  return { service, prisma, tx };
}

describe("DataRightsService.anonymizeCustomerById", () => {
  it("aucune facture conservée → anonymisation COMPLÈTE (name tombstone, phone/nif/creditLimit/dup nuls)", async () => {
    const { service, tx } = buildAnon(anonCustomer({ invoices: [{ documentType: "invoice", status: "draft", issuedAt: new Date() }] }));

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

  it("client déjà anonymisé → no-op idempotent, aucune 2e écriture de PII", async () => {
    const { service, tx } = buildAnon(anonCustomer({ anonymizedAt: new Date("2026-08-01T00:00:00.000Z") }));

    const result = await service.anonymizeCustomerById("cus-1", { requestedByUserId: "usr-1", viaOps: false });

    expect(result.outcome).toBe("completed");
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(tx.dataRightsRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "anonymization", note: expect.stringMatching(/déjà anonymisé/i) }),
    });
  });

  it("prend le verrou consultatif sur la clé customer:org:phone avant de lire les factures", async () => {
    const { service, tx } = buildAnon(anonCustomer());

    await service.anonymizeCustomerById("cus-1", { requestedByUserId: "usr-1", viaOps: false });

    expect(tx.$queryRaw).toHaveBeenCalled();
    const lockCallOrder = tx.$queryRaw.mock.invocationCallOrder[0];
    const updateCallOrder = tx.customer.update.mock.invocationCallOrder[0];
    expect(lockCallOrder).toBeLessThan(updateCallOrder);
  });

  it("client introuvable → outcome failed, pas de rejet brut", async () => {
    const { service, tx } = buildAnon(anonCustomer());
    tx.customer.findUnique.mockResolvedValue(null);

    const result = await service.anonymizeCustomerById("cus-404", { requestedByUserId: "usr-1", viaOps: false });

    expect(result.outcome).toBe("failed");
  });

  it("registre : affectedCustomerIds contient l'id anonymisé + hash du téléphone", async () => {
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
    const tx: any = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      customer: {
        findUnique: vi.fn((args: any) => Promise.resolve(args.where.id === "cus-a" ? c1 : c2)),
        update: vi.fn((args: any) => Promise.resolve({ ...args.data })),
      },
      dataRightsRequest: { create: vi.fn((args: any) => Promise.resolve({ id: "drr", ...args.data })) },
    };
    const prisma: any = {
      $transaction: vi.fn((cb: any) => cb(tx)),
      customer: { findMany: vi.fn().mockResolvedValue([c1, c2]) },
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
        affectedCustomerIds: expect.arrayContaining(["cus-a", "cus-b"]),
        viaOps: true,
        organizationId: null,
      }),
    });
  });
});
