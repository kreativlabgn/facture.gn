import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { FinancingService } from "./financing.service";

// organizationScopedClient() appelle `$extends`, et setOrganizationScope() pose le
// GUC via `$executeRaw`. Le vrai client offre les deux ; un faux qui ne les offre
// pas ne teste pas le service migré, il plante dessus. `$extends` rend le client
// LUI-MÊME pour que les mocks de modèle restent partagés et les assertions
// existantes inchangées. `$transaction` bi-forme : la forme tableau est celle
// qu'emploie makeScopedOperation(), ce qui rend l'extension rejouable.
function auClientScope<T extends Record<string, unknown>>(prisma: T): T {
  const p = prisma as Record<string, unknown>;
  p.$extends = vi.fn(() => prisma);
  p.$executeRaw = p.$executeRaw ?? vi.fn().mockResolvedValue(1);
  p.$transaction = p.$transaction ?? vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  for (const valeur of Object.values(p)) {
    const modele = valeur as Record<string, unknown> | null;
    if (!modele || typeof modele !== "object") continue;
    if (modele.findUniqueOrThrow && !modele.findFirstOrThrow) modele.findFirstOrThrow = modele.findUniqueOrThrow;
    if (modele.findUnique && !modele.findFirst) modele.findFirst = modele.findUnique;
  }
  return prisma;
}

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
    // setOrganizationScope(tx, ...) pose le GUC en première ligne de la
    // transaction : le vrai client transactionnel porte $executeRaw, le faux
    // doit donc l'offrir aussi.
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  return auClientScope({
    invoice: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(overrides.invoice ?? baseInvoice()),
    },
    financialPartner: {
      findMany: vi.fn().mockResolvedValue(overrides.partners ?? []),
      findUnique: vi.fn().mockResolvedValue(
        "partner" in overrides ? overrides.partner : { id: "partner-1", status: "active" },
      ),
    },
    // Bi-forme : le callback interactif du service ET la forme tableau
    // qu'emploie makeScopedOperation(), qui rend l'extension rejouable.
    $transaction: vi.fn().mockImplementation((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(tx))),
    __tx: tx,
  });
}

describe("FinancingService.getFinancingOptions (K4, ADR-031/088)", () => {
  it("liste les partenaires actifs quand la facture est finançable", async () => {
    const prisma = createFakePrisma({ partners: [{ id: "partner-1", name: "Ecobank", status: "active" }] });
    const service = new FinancingService(prisma as any);

    const result = await service.getFinancingOptions("inv-1", "org-1");

    expect(result.financeable).toBe(true);
    expect(result.partners).toHaveLength(1);
  });

  it("ne liste aucun partenaire quand la facture n'est pas finançable", async () => {
    const prisma = createFakePrisma({ invoice: baseInvoice({ validatedByAdministration: false }) });
    const service = new FinancingService(prisma as any);

    const result = await service.getFinancingOptions("inv-1", "org-1");

    expect(result.financeable).toBe(false);
    expect(result.partners).toEqual([]);
    expect(prisma.financialPartner.findMany).not.toHaveBeenCalled();
  });

  it("ne liste aucun partenaire si le PublicBuyerAccount lié n'est pas vérifié, même validée par l'administration (Security Audit 2026-08-23, finding #1)", async () => {
    const prisma = createFakePrisma({
      invoice: baseInvoice({ customer: { publicBuyerAccount: { verificationStatus: "pending" } } }),
    });
    const service = new FinancingService(prisma as any);

    const result = await service.getFinancingOptions("inv-1", "org-1");

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

    const result = await service.getFinancingOptions("inv-1", "org-1");

    expect(result.financeable).toBe(false);
    expect(result.partners).toEqual([]);
  });
});

describe("FinancingService.chooseFinancing (K4/K5, ADR-088/089)", () => {
  it("pose app.current_org_id en tête de la transaction de financement", async () => {
    const prisma = createFakePrisma();
    const service = new FinancingService(prisma as any);

    await service.chooseFinancing(
      "inv-1",
      { financialPartnerId: "partner-1", disbursementMethod: "payment_link_payout" },
      "user-1",
      "org-a-proteger",
    );

    const setConfig = (prisma as any).__tx.$executeRaw.mock.calls[0]?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-a-proteger");

    // Le GUC transactionnel et le CLIENT SCOPÉ (lecture de la facture) sont deux
    // constructions distinctes : muter l'une sans l'autre passerait inaperçu. La
    // valeur du client scopé n'est observable qu'en rejouant l'extension.
    const extension = (prisma as any).$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });
    const scopeClient = (prisma as any).$executeRaw.mock.calls.at(-1)?.[0];
    expect(scopeClient.values).toContain("org-a-proteger");
  });

  // `financial_partner` est un annuaire PLATEFORME, hors RLS : un partenaire
  // financier n'appartient à aucune PME. Le scoper viderait la liste des rails de
  // financement. Ce test garde ce « scope indûment posé » : la lecture doit passer
  // par le client de BASE, jamais par le client étendu.
  it("ne scope JAMAIS l'annuaire des partenaires financiers (table plateforme)", async () => {
    const prisma = createFakePrisma();
    const service = new FinancingService(prisma as any);

    await service.chooseFinancing(
      "inv-1",
      { financialPartnerId: "partner-1", disbursementMethod: "payment_link_payout" },
      "user-1",
      "org-1",
    );

    // Un seul $extends : celui du client scopé construit pour la facture. Si
    // l'annuaire partenaires passait aussi par un client scopé, il y en aurait
    // davantage — ou la lecture serait filtrée par une organisation qui n'a
    // aucun sens pour cette table.
    expect((prisma as any).$extends).toHaveBeenCalledTimes(1);
    expect(prisma.financialPartner.findUnique).toHaveBeenCalledWith({ where: { id: "partner-1" } });
  });


  it("pose financedByPartnerId/financedAt et émet financing_disbursed sur une facture finançable", async () => {
    const prisma = createFakePrisma();
    const service = new FinancingService(prisma as any);

    await service.chooseFinancing("inv-1",
      { financialPartnerId: "partner-1", disbursementMethod: "payment_link_payout" },
      "user-1", "org-1"
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
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1", "org-1"),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejette (ConflictException) une facture déjà financée (K5, anti-double financement)", async () => {
    const prisma = createFakePrisma({ invoice: baseInvoice({ financedByPartnerId: "autre-partner" }) });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1", "org-1"),
    ).rejects.toThrow(/déjà financée|non finançable/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejette un financialPartnerId inconnu", async () => {
    const prisma = createFakePrisma({ partner: null });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-inconnu", disbursementMethod: "bank_transfer" }, "user-1", "org-1"),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejette un partenaire suspended", async () => {
    const prisma = createFakePrisma({ partner: { id: "partner-1", status: "suspended" } });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1", "org-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("la clause where transactionnelle revérifie status et validatedByAdministration, pas seulement financedByPartnerId (protège contre un void() concurrent)", async () => {
    const prisma = createFakePrisma();
    const service = new FinancingService(prisma as any);

    await service.chooseFinancing("inv-1",
      { financialPartnerId: "partner-1", disbursementMethod: "payment_link_payout" },
      "user-1", "org-1"
    );

    expect(prisma.__tx.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: "inv-1",
        organizationId: "org-1",
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
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1", "org-1"),
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
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1", "org-1"),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuse une double demande concurrente — la seconde requête échoue proprement (K5)", async () => {
    const prisma = createFakePrisma({ updateManyCount: 0 });
    const service = new FinancingService(prisma as any);

    await expect(
      service.chooseFinancing("inv-1", { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" }, "user-1", "org-1"),
    ).rejects.toThrow(ConflictException);
    expect(prisma.__tx.invoiceEvent.create).not.toHaveBeenCalled();
  });

  // K5 — DOUBLE CLIC RÉELLEMENT CONCURRENT, et le CODE HTTP qu'il produit.
  //
  // Le test au-dessus fige déjà le comportement (la seconde demande échoue),
  // mais il l'obtient d'un `updateManyCount: 0` posé d'avance : il n'exécute
  // jamais deux appels en même temps, et n'assure que la CLASSE de l'exception.
  // Or ce qui est promis au client, c'est un 409 — pas un 500 opaque. Cette
  // application n'a AUCUN ExceptionFilter (constat repris dans
  // public-buyer-portal.service.ts) : seule la nature HttpException de
  // ConflictException garantit le code rendu. Une refonte qui lèverait une
  // erreur maison non-HttpException passerait le `toThrow(ConflictException)`
  // d'à côté tout en dégradant la réponse en 500 — d'où l'assertion sur
  // getStatus() ici, et le lancement simultané des deux demandes.
  it("sur deux demandes simultanées, une seule aboutit et l'autre rend un 409 explicite (jamais un 500)", async () => {
    const prisma = createFakePrisma();
    // La clause `where` de l'updateMany est le SEUL point de sérialisation réel
    // (voir chooseFinancing) : on la rend stateful pour que la première
    // revendication gagne et que la seconde trouve count === 0 — exactement ce
    // que ferait Postgres sur deux transactions concurrentes.
    let dejaRevendiquee = false;
    prisma.__tx.invoice.updateMany.mockImplementation(() => {
      if (dejaRevendiquee) {
        return Promise.resolve({ count: 0 });
      }
      dejaRevendiquee = true;
      return Promise.resolve({ count: 1 });
    });
    const service = new FinancingService(prisma as any);
    const dto = { financialPartnerId: "partner-1", disbursementMethod: "bank_transfer" as const };

    const resultats = await Promise.allSettled([
      service.chooseFinancing("inv-1", dto, "user-1", "org-1"),
      service.chooseFinancing("inv-1", dto, "user-1", "org-1"),
    ]);

    const aboutis = resultats.filter((r) => r.status === "fulfilled");
    const rejetes = resultats.filter((r) => r.status === "rejected");
    expect(aboutis).toHaveLength(1);
    expect(rejetes).toHaveLength(1);

    const erreur = (rejetes[0] as PromiseRejectedResult).reason as ConflictException;
    expect(erreur).toBeInstanceOf(ConflictException);
    // LE point de ce test : le code réellement rendu au client.
    expect(erreur.getStatus()).toBe(409);

    // K5 — une seule cession, donc une seule trace d'audit : jamais deux
    // financing_disbursed sur la même facture.
    expect(prisma.__tx.invoiceEvent.create).toHaveBeenCalledTimes(1);
  });
});
