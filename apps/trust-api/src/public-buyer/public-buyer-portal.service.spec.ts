import { describe, expect, it, vi } from "vitest";
import { PublicBuyerPortalService } from "./public-buyer-portal.service";

const REQUESTER_USER_ID = "user-daf-1";
const OTHER_PBA_MEMBER_USER_ID = "user-daf-2";

function createFakePrisma(
  overrides: {
    publicBuyerAccountMember?: any;
    invoice?: any;
    customer?: any;
  } = {},
) {
  const tx = {
    invoice: {
      update: vi.fn().mockResolvedValue({
        id: "inv-1",
        validatedByAdministration: true,
      }),
    },
    invoiceEvent: {
      create: vi.fn().mockResolvedValue({ id: "evt-1", type: "liquidation_validated" }),
    },
  };
  return {
    publicBuyerAccountMember: {
      findFirst: vi.fn().mockResolvedValue({ id: "pbam-1", publicBuyerAccountId: "pba-1", userId: REQUESTER_USER_ID }),
      ...overrides.publicBuyerAccountMember,
    },
    invoice: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "inv-1",
        status: "issued",
        validatedByAdministration: false,
        amountDue: 5_000_000n,
        customerId: "cust-1",
      }),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amountDue: null } }),
      ...overrides.invoice,
    },
    customer: {
      findUnique: vi.fn().mockResolvedValue({ id: "cust-1", publicBuyerAccountId: "pba-1" }),
      ...overrides.customer,
    },
    $transaction: vi.fn().mockImplementation((fn: any) => fn(tx)),
    __tx: tx,
  };
}

describe("PublicBuyerPortalService — validation de liquidation (J1, ADR-080/081/098)", () => {
  it("refuse un appelant qui n'est PAS membre du public_buyer_account propriétaire du client de la facture (IDOR)", async () => {
    const prisma = createFakePrisma({
      publicBuyerAccountMember: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const service = new PublicBuyerPortalService(prisma as any);

    await expect(
      service.validateLiquidation("inv-1", OTHER_PBA_MEMBER_USER_ID),
    ).rejects.toThrow(/aucun accès|accès/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuse une facture dont le client n'a pas de publicBuyerAccountId (pas une facture B2G)", async () => {
    const prisma = createFakePrisma({
      customer: { findUnique: vi.fn().mockResolvedValue({ id: "cust-1", publicBuyerAccountId: null }) },
    });
    const service = new PublicBuyerPortalService(prisma as any);

    await expect(service.validateLiquidation("inv-1", REQUESTER_USER_ID)).rejects.toThrow(/B2G|entité publique/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuse une facture encore en draft — jamais avant issued", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          validatedByAdministration: false,
          customerId: "cust-1",
        }),
      },
    });
    const service = new PublicBuyerPortalService(prisma as any);

    await expect(service.validateLiquidation("inv-1", REQUESTER_USER_ID)).rejects.toThrow(/draft|émise|issued/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("pose validatedByAdministration=true et crée un InvoiceEvent liquidation_validated sur une facture éligible", async () => {
    const prisma = createFakePrisma();
    const service = new PublicBuyerPortalService(prisma as any);

    const result = await service.validateLiquidation("inv-1", REQUESTER_USER_ID);

    expect(prisma.publicBuyerAccountMember.findFirst).toHaveBeenCalledWith({
      where: { publicBuyerAccountId: "pba-1", userId: REQUESTER_USER_ID },
    });
    expect(prisma.__tx.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { validatedByAdministration: true },
    });
    expect(prisma.__tx.invoiceEvent.create).toHaveBeenCalledWith({
      data: { invoiceId: "inv-1", type: "liquidation_validated", actorId: REQUESTER_USER_ID },
    });
    expect(result.validatedByAdministration).toBe(true);
  });

  it("est idempotent — un second appel sur une facture déjà validée ne duplique aucun InvoiceEvent", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "issued",
          validatedByAdministration: true,
          customerId: "cust-1",
        }),
      },
    });
    const service = new PublicBuyerPortalService(prisma as any);

    const result = await service.validateLiquidation("inv-1", REQUESTER_USER_ID);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result.validatedByAdministration).toBe(true);
  });

  it("refuse une facture voided — aucune dette réelle à liquider (PRD §4.2)", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "voided",
          validatedByAdministration: false,
          customerId: "cust-1",
        }),
      },
    });
    const service = new PublicBuyerPortalService(prisma as any);

    await expect(service.validateLiquidation("inv-1", REQUESTER_USER_ID)).rejects.toThrow(/voided|annulée/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("la réponse idempotente n'a jamais de relation customer imbriquée (forme identique à la validation fraîche)", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "issued",
          validatedByAdministration: true,
          customerId: "cust-1",
        }),
      },
    });
    const service = new PublicBuyerPortalService(prisma as any);

    const result = await service.validateLiquidation("inv-1", REQUESTER_USER_ID);

    expect(result).not.toHaveProperty("customer");
  });
});

describe("PublicBuyerPortalService — encours fournisseurs (J2, ADR-080/098)", () => {
  it("ne renvoie que les factures des clients rattachés au public_buyer_account de l'appelant", async () => {
    const prisma = createFakePrisma();
    const service = new PublicBuyerPortalService(prisma as any);

    await service.listReceivedInvoices(REQUESTER_USER_ID, {});

    expect(prisma.publicBuyerAccountMember.findFirst).toHaveBeenCalledWith({
      where: { userId: REQUESTER_USER_ID },
    });
    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: { customer: { publicBuyerAccountId: "pba-1" }, status: { notIn: ["draft", "voided"] } },
      orderBy: { issuedAt: "desc" },
      take: 50,
      skip: 0,
    });
  });

  it("exclut les factures draft et voided — jamais reçues ou plus une dette réelle", async () => {
    const prisma = createFakePrisma();
    const service = new PublicBuyerPortalService(prisma as any);

    await service.listReceivedInvoices(REQUESTER_USER_ID, {});

    const calledWhere = prisma.invoice.findMany.mock.calls[0][0].where;
    expect(calledWhere.status).toEqual({ notIn: ["draft", "voided"] });
  });

  it("refuse un appelant qui n'est membre d'aucun public_buyer_account", async () => {
    const prisma = createFakePrisma({ publicBuyerAccountMember: { findFirst: vi.fn().mockResolvedValue(null) } });
    const service = new PublicBuyerPortalService(prisma as any);

    await expect(service.listReceivedInvoices(REQUESTER_USER_ID, {})).rejects.toThrow(/accès/i);
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it("calcule l'encours total (SUM amountDue) sur le même périmètre que la liste", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: "inv-1" }, { id: "inv-2" }]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountDue: 12_500_000n } }),
      },
    });
    const service = new PublicBuyerPortalService(prisma as any);

    const result = await service.listReceivedInvoices(REQUESTER_USER_ID, {});

    expect(prisma.invoice.aggregate).toHaveBeenCalledWith({
      where: { customer: { publicBuyerAccountId: "pba-1" }, status: { notIn: ["draft", "voided"] } },
      _sum: { amountDue: true },
    });
    expect(result.outstandingTotal).toBe(12_500_000n);
    expect(result.invoices).toHaveLength(2);
  });
});
