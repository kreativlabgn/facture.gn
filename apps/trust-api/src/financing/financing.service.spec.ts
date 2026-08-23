import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { FinancingService } from "./financing.service";

function baseInvoice(overrides: Record<string, any> = {}) {
  return {
    id: "inv-1",
    totalTtc: 5_000_000n,
    validatedByAdministration: true,
    financedByPartnerId: null,
    status: "issued",
    // Security Audit 2026-08-23, finding #1 — PublicBuyerAccount vérifié par
    // défaut dans ces fixtures ; voir le test dédié plus bas pour le cas non-vérifié.
    // Security Audit 2026-08-23, revue post-fix #1 — isPublicEntityConfirmed:true
    // par défaut (lien confirmé par le compte cible) ; voir les tests dédiés plus
    // bas pour le scénario de repointage post-validation (finding #1 CRITIQUE).
    customer: { isPublicEntityConfirmed: true, publicBuyerAccount: { verificationStatus: "verified" } },
    ...overrides,
  };
}

function createFakePrisma(
  overrides: {
    invoice?: any;
    partners?: any[];
    partner?: any;
    updateManyCount?: number;
  } = {},
) {
  const tx = {
    invoice: {
      updateMany: vi.fn().mockResolvedValue({ count: overrides.updateManyCount ?? 1 }),
    },
    invoiceEvent: {
      create: vi.fn().mockResolvedValue({ id: "event-1" }),
    },
  };
  return {
    invoice: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(overrides.invoice ?? baseInvoice()),
    },
    financialPartner: {
      findMany: vi.fn().mockResolvedValue(overrides.partners ?? []),
      findUnique: vi.fn().mockResolvedValue(
        "partner" in overrides ? overrides.partner : { id: "partner-1", status: "active" },
      ),
    },
    $transaction: vi.fn().mockImplementation((fn: any) => fn(tx)),
    __tx: tx,
  };
}

describe("FinancingService.getFinancingOptions (K4, ADR-031/088)", () => {
  it("liste les partenaires actifs quand la facture est finançable", async () => {
    const prisma = createFakePrisma({ partners: [{ id: "partner-1", name: "Ecobank", status: "active" }] });
    const service = new FinancingService(prisma as any);

    const result = await service.getFinancingOptions("inv-1");

    expect(result.financeable).toBe(true);
    expect(result.partners).toHaveLength(1);
  });

  it("ne liste aucun partenaire quand la facture n'est pas finançable", async () => {
    const prisma = createFakePrisma({ invoice: baseInvoice({ validatedByAdministration: false }) });
    const service = new FinancingService(prisma as any);

    const result = await service.getFinancingOptions("inv-1");

    expect(result.financeable).toBe(false);
    expect(result.partners).toEqual([]);
    expect(prisma.financialPartner.findMany).not.toHaveBeenCalled();
  });

  it("ne liste aucun partenaire si le PublicBuyerAccount lié n'est pas vérifié, même validée par l'administration (Security Audit 2026-08-23, finding #1)", async () => {
    const prisma = createFakePrisma({
      invoice: baseInvoice({ customer: { publicBuyerAccount: { verificationStatus: "pending" } } }),
    });
    const service = new FinancingService(prisma as any);

    const result = await service.getFinancingOptions("inv-1");

    expect(result.financeable).toBe(false);
    expect(result.partners).toEqual([]);
  });

  it("ne liste aucun partenaire si le lien customer<->public_buyer_account n'a jamais été confirmé par le compte cible, même si ce compte est verified (Security Audit 2026-08-23, revue post-fix #1, finding #1 CRITIQUE) — repointage post-validation vers un vrai compte", async () => {
    const prisma = createFakePrisma({
      invoice: baseInvoice({
        customer: { isPublicEntityConfirmed: false, publicBuyerAccount: { verificationStatus: "verified" } },
      }),
    });
    const service = new FinancingService(prisma as any);

    const result = await service.getFinancingOptions("inv-1");

    expect(result.financeable).toBe(false);
    expect(result.partners).toEqual([]);
  });
});

describe("FinancingService.chooseFinancing (K4/K5, ADR-088/089)", () => {
  it("pose financedByPartnerId/financedAt et émet financing_disbursed sur une facture finançable", async () => {
    const prisma = createFakePrisma();
    const service = new FinancingService(prisma as any);

    await service.chooseFinancing(
      "inv-1",
      { financialPartnerId: "partner-1", disbursementMethod: "payment_link_payout" },
      "user-1",
    );

    expect(prisma.__tx.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "inv-1", financedByPartnerId: null }),
        data: { financedByPartnerId: "partner-1", financedAt: expect.any(Date) },
      }),
    );
    expect(prisma.__tx.invoiceEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: "inv-1",
        type: "financing_disbursed",
        actorId: "user-1",
        amount: 5_000_000n,
      }),
    });
  });

  it("rejette (ConflictException) une facture non validée par l'administration", async () => {
    const prisma = createFakePrisma({ invoice: baseInvoice({ validatedByAdministration: false }) });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1"),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejette (ConflictException) une facture déjà financée (K5, anti-double financement)", async () => {
    const prisma = createFakePrisma({ invoice: baseInvoice({ financedByPartnerId: "autre-partner" }) });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1"),
    ).rejects.toThrow(/déjà financée|non finançable/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejette un financialPartnerId inconnu", async () => {
    const prisma = createFakePrisma({ partner: null });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-inconnu", disbursementMethod: "bank_transfer" }, "user-1"),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejette un partenaire suspended", async () => {
    const prisma = createFakePrisma({ partner: { id: "partner-1", status: "suspended" } });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("la clause where transactionnelle revérifie status et validatedByAdministration, pas seulement financedByPartnerId (protège contre un void() concurrent)", async () => {
    const prisma = createFakePrisma();
    const service = new FinancingService(prisma as any);

    await service.chooseFinancing(
      "inv-1",
      { financialPartnerId: "partner-1", disbursementMethod: "payment_link_payout" },
      "user-1",
    );

    expect(prisma.__tx.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: "inv-1",
        financedByPartnerId: null,
        validatedByAdministration: true,
        status: { not: "voided" },
        customer: {
          isPublicEntityConfirmed: true,
          publicBuyerAccount: { verificationStatus: "verified" },
        },
      },
      data: { financedByPartnerId: "partner-1", financedAt: expect.any(Date) },
    });
  });

  // Security Audit 2026-08-23, revue post-fix #1 (finding #1 CRITIQUE) — la
  // revue globale a trouvé que le scénario d'attaque complet n'était prouvé par
  // aucun test au niveau de chooseFinancing() (la mutation réelle qui déplace
  // l'éligibilité au financement), seulement au niveau de getFinancingOptions()
  // (simple affichage). Ces deux tests ferment ce trou.
  it("rejette chooseFinancing() sur un PublicBuyerAccount pending — l'auto-attestation frauduleuse ne peut jamais obtenir de financement réel", async () => {
    const prisma = createFakePrisma({
      invoice: baseInvoice({
        customer: { isPublicEntityConfirmed: true, publicBuyerAccount: { verificationStatus: "pending" } },
      }),
    });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1"),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejette chooseFinancing() si le lien n'a jamais été confirmé par le compte cible, même verified — ferme le contournement par repointage post-validation", async () => {
    const prisma = createFakePrisma({
      invoice: baseInvoice({
        customer: { isPublicEntityConfirmed: false, publicBuyerAccount: { verificationStatus: "verified" } },
      }),
    });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1"),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuse une double demande concurrente — la seconde requête échoue proprement (K5)", async () => {
    const prisma = createFakePrisma({ updateManyCount: 0 });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1"),
    ).rejects.toThrow(ConflictException);
    expect(prisma.__tx.invoiceEvent.create).not.toHaveBeenCalled();
  });
});
