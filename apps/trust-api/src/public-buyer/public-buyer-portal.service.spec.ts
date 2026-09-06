import { describe, expect, it, vi } from "vitest";
import { PublicBuyerPortalService } from "./public-buyer-portal.service";

const REQUESTER_USER_ID = "user-daf-1";
const OTHER_PBA_MEMBER_USER_ID = "user-daf-2";

function createFakePrisma(
  overrides: {
    publicBuyerAccountMember?: any;
    invoice?: any;
    customer?: any;
    publicBuyerAccount?: any;
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
    // setOrganizationScope(tx, ...) pose le GUC en première ligne de la
    // transaction : le vrai client transactionnel porte $executeRaw, le faux
    // doit donc l'offrir aussi (inerte — la pose réelle du set_config est
    // couverte par packages/db, rls.spec.ts).
    $executeRaw: vi.fn().mockResolvedValue(1),
  };

  const prisma: any = {
    publicBuyerAccountMember: {
      findFirst: vi.fn().mockResolvedValue({ id: "pbam-1", publicBuyerAccountId: "pba-1", userId: REQUESTER_USER_ID }),
      ...overrides.publicBuyerAccountMember,
    },
    invoice: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "inv-1",
        organizationId: "org-fournisseur",
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
      // Security Audit 2026-08-23, finding #13 — isPublicEntityConfirmed: true par
      // défaut ici (lien déjà confirmé par le compte acheteur public) ; voir les
      // tests dédiés plus bas pour le cas non-confirmé et confirmCustomerLink().
      findUnique: vi.fn().mockResolvedValue({ id: "cust-1", organizationId: "org-fournisseur", publicBuyerAccountId: "pba-1", isPublicEntityConfirmed: true }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "cust-1", organizationId: "org-fournisseur", publicBuyerAccountId: "pba-1", isPublicEntityConfirmed: true }),
      update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
      ...overrides.customer,
    },
    // Security Audit 2026-08-23, revue post-fix #1 — verified par défaut ici
    // (compte institutionnel légitime) ; voir le test dédié plus bas pour le cas
    // "pending" (finding #1 CRITIQUE, auto-attestation frauduleuse).
    publicBuyerAccount: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "pba-1", verificationStatus: "verified" }),
      ...overrides.publicBuyerAccount,
    },
    $transaction: vi.fn().mockImplementation((arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(tx),
    ),
    // organizationScopedClient() appelle $extends ; setOrganizationScope() pose le
    // GUC via $executeRaw. $extends rend le client LUI-MÊME, pour que les mocks de
    // modèle restent partagés et les assertions existantes inchangées.
    $extends: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(1),
    __tx: tx,
  };

  prisma.$extends.mockReturnValue(prisma);

  // Les DEUX lectures de client du service passent désormais par findFirst et ne
  // se distinguent que par la présence de `organizationId` dans le `where` :
  //   • avec  → lecture SCOPÉE de validateLiquidation() ;
  //   • sans  → lecture de DÉCOUVERTE de confirmCustomerLink().
  // On dispatche vers les deux mocks historiques plutôt que de les fusionner :
  // toutes les surcharges déjà écrites par les tests gardent ainsi leur effet.
  prisma.customer.findFirst = vi.fn(({ where }: any) =>
    where?.organizationId !== undefined
      ? prisma.customer.findUnique({ where })
      : prisma.customer.findUniqueOrThrow({ where }),
  );
  prisma.invoice.findFirst = vi.fn(({ where }: any) => prisma.invoice.findUniqueOrThrow({ where }));

  return prisma;
}

describe("PublicBuyerPortalService — validation de liquidation (J1, ADR-080/081/098)", () => {
  // Régression : ce chemin passait par findUniqueOrThrow, dont la NotFoundError
  // Prisma n'était interceptée par aucun ExceptionFilter (il n'y en a aucun dans
  // cette application) — un invoiceId inconnu remontait en 500, distinguable du
  // 403 d'une facture non-B2G, soit un oracle d'énumération sur un :id fourni par
  // l'appelant. Les deux cas renvoient désormais le même message.
  it("répond comme pour une facture non-B2G sur un invoiceId inexistant — jamais un 500, jamais un oracle", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(null) },
    });
    const service = new PublicBuyerPortalService(prisma as any);

    await expect(service.validateLiquidation("inv-inconnue", REQUESTER_USER_ID)).rejects.toThrow(
      /B2G|entité publique/i,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Les faux `$extends` de ce dépôt se renvoient eux-mêmes : la VALEUR du scope
  // n'est donc pas observable directement, et vérifier que `$extends` a été
  // appelé ne prouverait rien sur l'organisation réellement posée. On rejoue ici
  // l'extension capturée — `$allOperations` exécute le set_config via
  // `$executeRaw` — pour lire l'identifiant qui y a été injecté. Même technique
  // que client-portal.service.spec.ts. (Le helper lui-même est couvert par
  // packages/db, rls.spec.ts.)
  it("pose le scope RLS de l'organisation ÉMETTRICE, résolue depuis la facture", async () => {
    const prisma = createFakePrisma();
    const service = new PublicBuyerPortalService(prisma as any);

    await service.validateLiquidation("inv-1", REQUESTER_USER_ID);

    const extension = prisma.$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });

    const setConfig = prisma.$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("org-fournisseur");
    expect(setConfig.values).toContain("app.current_org_id");
  });


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
      customer: { findUnique: vi.fn().mockResolvedValue({ id: "cust-1", organizationId: "org-fournisseur", publicBuyerAccountId: null }) },
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
          organizationId: "org-fournisseur",
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
          organizationId: "org-fournisseur",
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
          organizationId: "org-fournisseur",
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

  it("refuse de valider la liquidation tant que le lien client<->compte acheteur public n'a pas été confirmé (Security Audit 2026-08-23, finding #13)", async () => {
    const prisma = createFakePrisma({
      customer: {
        findUnique: vi.fn().mockResolvedValue({ id: "cust-1", organizationId: "org-fournisseur", publicBuyerAccountId: "pba-1", isPublicEntityConfirmed: false }),
      },
    });
    const service = new PublicBuyerPortalService(prisma as any);

    await expect(service.validateLiquidation("inv-1", REQUESTER_USER_ID)).rejects.toThrow(/confirmé/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuse de valider la liquidation via un PublicBuyerAccount non vérifié (Security Audit 2026-08-23, revue post-fix #1, finding #1 CRITIQUE) — l'auto-attestation frauduleuse elle-même", async () => {
    // Scénario d'attaque du finding critique : un attaquant crée son propre
    // PublicBuyerAccount (pending par défaut, self-service), en devient membre,
    // rattache son propre client, confirme le lien lui-même (membre du compte
    // ciblé), puis tente de valider la liquidation de sa propre facture SANS
    // qu'aucune vraie administration n'ait jamais rien vérifié.
    const prisma = createFakePrisma({
      publicBuyerAccount: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "pba-1", verificationStatus: "pending" }) },
    });
    const service = new PublicBuyerPortalService(prisma as any);

    await expect(service.validateLiquidation("inv-1", REQUESTER_USER_ID)).rejects.toThrow(/vérifié/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("la réponse idempotente n'a jamais de relation customer imbriquée (forme identique à la validation fraîche)", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          organizationId: "org-fournisseur",
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
      where: {
        customer: { publicBuyerAccountId: "pba-1", isPublicEntityConfirmed: true },
        status: { notIn: ["draft", "voided"] },
      },
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
      where: {
        customer: { publicBuyerAccountId: "pba-1", isPublicEntityConfirmed: true },
        status: { notIn: ["draft", "voided"] },
      },
      _sum: { amountDue: true },
    });
    expect(result.outstandingTotal).toBe(12_500_000n);
    expect(result.invoices).toHaveLength(2);
  });
});

describe("PublicBuyerPortalService.confirmCustomerLink (Security Audit 2026-08-23, finding #13)", () => {
  it("pose isPublicEntityConfirmed=true quand l'appelant est membre du compte acheteur public ciblé", async () => {
    const prisma = createFakePrisma({
      customer: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ id: "cust-1", organizationId: "org-fournisseur", publicBuyerAccountId: "pba-1", isPublicEntityConfirmed: false }),
      },
    });
    const service = new PublicBuyerPortalService(prisma as any);

    const result = await service.confirmCustomerLink("cust-1", REQUESTER_USER_ID);

    expect(prisma.publicBuyerAccountMember.findFirst).toHaveBeenCalledWith({
      where: { publicBuyerAccountId: "pba-1", userId: REQUESTER_USER_ID },
    });
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: "cust-1" },
      data: { isPublicEntityConfirmed: true },
    });
    expect(result.isPublicEntityConfirmed).toBe(true);
  });

  it("refuse un appelant qui n'est pas membre du compte acheteur public ciblé (IDOR)", async () => {
    const prisma = createFakePrisma({
      publicBuyerAccountMember: { findFirst: vi.fn().mockResolvedValue(null) },
      customer: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ id: "cust-1", organizationId: "org-fournisseur", publicBuyerAccountId: "pba-1", isPublicEntityConfirmed: false }),
      },
    });
    const service = new PublicBuyerPortalService(prisma as any);

    await expect(service.confirmCustomerLink("cust-1", OTHER_PBA_MEMBER_USER_ID)).rejects.toThrow(/accès/i);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("refuse un client jamais rattaché à un compte acheteur public", async () => {
    const prisma = createFakePrisma({
      customer: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "cust-1", organizationId: "org-fournisseur", publicBuyerAccountId: null, isPublicEntityConfirmed: false }),
      },
    });
    const service = new PublicBuyerPortalService(prisma as any);

    await expect(service.confirmCustomerLink("cust-1", REQUESTER_USER_ID)).rejects.toThrow(/rattaché/i);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
});
