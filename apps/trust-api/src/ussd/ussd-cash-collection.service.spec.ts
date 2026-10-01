import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

// organizationScopedClient() appelle `$extends` sur le client. Le vrai client
// l'offre ; un faux qui ne l'offre pas ne teste pas le service migré, il plante
// dessus. `$extends` rend ici le client LUI-MÊME, pour que les mocks de modèle
// restent partagés et les assertions existantes sur les arguments inchangées.
// (La pose effective du set_config est couverte par packages/db rls.spec.ts.)
function auClientScope<T extends Record<string, unknown>>(prisma: T): T {
  const p = prisma as Record<string, unknown>;
  p.$extends = vi.fn(() => prisma);
  p.$executeRaw = p.$executeRaw ?? vi.fn().mockResolvedValue(1);
  for (const valeur of Object.values(p)) {
    const modele = valeur as Record<string, unknown> | null;
    if (!modele || typeof modele !== "object") continue;
    if (modele.findUniqueOrThrow && !modele.findFirstOrThrow) modele.findFirstOrThrow = modele.findUniqueOrThrow;
    if (modele.findUnique && !modele.findFirst) modele.findFirst = modele.findUnique;
  }
  return prisma;
}
import { UssdCashCollectionService } from "./ussd-cash-collection.service";

const ORG_ID = "org-1";
const ORG_B = "org-b";
const INVOICE_ID = "inv-1";

function createFakePrisma(overrides: { invoice?: any; organization?: any } = {}) {
  return auClientScope({
    invoice: {
      findFirst: vi.fn().mockResolvedValue(overrides.invoice ?? null),
    },
    organization: {
      findFirstOrThrow: vi.fn().mockResolvedValue(overrides.organization ?? { id: ORG_ID, commissionBypassProofThresholdOverrideGnf: null }),
    },
  });
}

// Fake qui APPLIQUE réellement le `where` (organizationId + statut) — nécessaire
// pour prouver l'absence d'IDOR, pas seulement la forme de l'appel.
function createRealisticPrisma(invoices: any[]) {
  return auClientScope({
    invoice: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const match = invoices.find(
          (inv) => inv.id === where.id && inv.organizationId === where.organizationId && where.status.in.includes(inv.status),
        );
        return Promise.resolve(match ?? null);
      }),
    },
    organization: {
      findFirstOrThrow: vi.fn().mockResolvedValue({ id: ORG_ID, commissionBypassProofThresholdOverrideGnf: null }),
    },
  });
}

// Même principe que createRealisticPrisma ci-dessus, mais pour la forme de
// requête utilisée par collect() (findFirst({ where: { id, organizationId } }),
// sans filtre de statut dans le where — le statut est revérifié séparément
// après lecture). Nécessaire pour prouver l'absence d'IDOR sur le chemin
// d'ÉCRITURE (pas seulement l'aperçu previewCollectible ci-dessus).
function createRealisticPrismaForCollect(invoices: any[], organizationOverride: Record<string, unknown> = {}) {
  return auClientScope({
    invoice: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const match = invoices.find((inv) => inv.id === where.id && inv.organizationId === where.organizationId);
        return Promise.resolve(match ?? null);
      }),
    },
    organization: {
      findFirstOrThrow: vi.fn().mockResolvedValue({ id: ORG_ID, commissionBypassProofThresholdOverrideGnf: null, ...organizationOverride }),
    },
  });
}

function createFakeOrganizationsService(overrides: { listMine?: ReturnType<typeof vi.fn> } = {}) {
  return { listMine: overrides.listMine ?? vi.fn().mockResolvedValue([]) };
}

function createFakePaymentsService(overrides: { recordCashPayment?: ReturnType<typeof vi.fn> } = {}) {
  return { recordCashPayment: overrides.recordCashPayment ?? vi.fn().mockResolvedValue({ id: "payment-1" }) };
}

describe("UssdCashCollectionService — previewCollectible (aperçu avant confirmation, capacités 2/3)", () => {
  it("retourne id/number/amountDue quand la facture est payable et scopée à l'organisation", async () => {
    const prisma = createFakePrisma({ invoice: { id: INVOICE_ID, organizationId: ORG_ID, number: "FG-2026-000001", status: "issued", amountDue: 500_000n } });
    const service = new UssdCashCollectionService(prisma as any, createFakeOrganizationsService() as any, createFakePaymentsService() as any);

    const result = await service.previewCollectible(ORG_ID, INVOICE_ID);

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith({
      where: { id: INVOICE_ID, organizationId: ORG_ID, status: { in: ["issued", "partially_paid"] } },
    });
    expect(result).toEqual({ id: INVOICE_ID, number: "FG-2026-000001", amountDue: 500_000n });
  });

  it("retourne null si la facture est introuvable ou n'est plus payable (paid/voided)", async () => {
    const prisma = createFakePrisma({ invoice: null });
    const service = new UssdCashCollectionService(prisma as any, createFakeOrganizationsService() as any, createFakePaymentsService() as any);

    await expect(service.previewCollectible(ORG_ID, INVOICE_ID)).resolves.toBeNull();
  });

  it("ne fait jamais fuiter une facture d'une AUTRE organisation, même avec le même invoiceId (IDOR)", async () => {
    const invoices = [{ id: INVOICE_ID, organizationId: ORG_B, number: "FG-2026-000099", status: "issued", amountDue: 200_000n }];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdCashCollectionService(prisma as any, createFakeOrganizationsService() as any, createFakePaymentsService() as any);

    await expect(service.previewCollectible(ORG_ID, INVOICE_ID)).resolves.toBeNull();
  });
});

const SESSION_ID = "ATUid_abc123";
const USER_ID = "user-1";

function createIdempotentFakePaymentsService() {
  const byKey = new Map<string, unknown>();
  let nextId = 1;
  return {
    recordCashPayment: vi.fn().mockImplementation((invoiceId: string, _organizationId: string, dto: any, idempotencyKey: string) => {
      if (byKey.has(idempotencyKey)) {
        return Promise.resolve(byKey.get(idempotencyKey));
      }
      const payment = { id: `payment-${nextId++}`, invoiceId, amount: dto.amount };
      byKey.set(idempotencyKey, payment);
      return Promise.resolve(payment);
    }),
  };
}

// *620#, capacité 3 (encaissement cash) — plan 2026-09-16-ussd-flash-recherche-encaissement-cash.md, Groupe D.
describe("UssdCashCollectionService — collect (encaissement, capacité 3)", () => {
  it("rôle non éligible (viewer) → ForbiddenException, aucune lecture de facture", async () => {
    const prisma = createFakePrisma();
    const organizationsService = createFakeOrganizationsService({
      listMine: vi.fn().mockResolvedValue([{ id: ORG_ID, role: "viewer" }]),
    });
    const paymentsService = createFakePaymentsService();
    const service = new UssdCashCollectionService(prisma as any, organizationsService as any, paymentsService as any);

    await expect(service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID)).rejects.toThrow(ForbiddenException);
    expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
    expect(paymentsService.recordCashPayment).not.toHaveBeenCalled();
  });

  it("rôle non éligible (field_agent) → ForbiddenException", async () => {
    const prisma = createFakePrisma();
    const organizationsService = createFakeOrganizationsService({
      listMine: vi.fn().mockResolvedValue([{ id: ORG_ID, role: "field_agent" }]),
    });
    const service = new UssdCashCollectionService(prisma as any, organizationsService as any, createFakePaymentsService() as any);

    await expect(service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID)).rejects.toThrow(ForbiddenException);
  });

  // Revue QA — la matrice de test exige "PLUSIEURS rôles inéligibles, pas un
  // seul cas" (RBAC, CONTRIBUTING.md §RBAC : répéter les passes jusqu'à un
  // "solide" explicite). Couvre ici la TOTALITÉ des valeurs restantes de
  // OrganizationRole (schema.prisma l.405) qui ne sont PAS dans
  // CASH_COLLECTION_ELIGIBLE_ROLES — viewer et field_agent déjà couverts
  // individuellement ci-dessus.
  it.each([
    "accountant_internal",
    "delivery_driver",
    "client_portal",
    "auditor",
    "approver",
    "tax_controller_readonly",
    "developer_api",
    "inventory_manager",
  ])("rôle non éligible (%s) → ForbiddenException, aucun paiement enregistré", async (role) => {
    const prisma = createFakePrisma();
    const organizationsService = createFakeOrganizationsService({
      listMine: vi.fn().mockResolvedValue([{ id: ORG_ID, role }]),
    });
    const paymentsService = createFakePaymentsService();
    const service = new UssdCashCollectionService(prisma as any, organizationsService as any, paymentsService as any);

    await expect(service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID)).rejects.toThrow(ForbiddenException);
    expect(paymentsService.recordCashPayment).not.toHaveBeenCalled();
  });

  // Revue QA — même liste, sens positif : les 3 rôles réellement éligibles ne
  // sont JAMAIS rejetés (régression si un futur refactor rétrécissait
  // accidentellement CASH_COLLECTION_ELIGIBLE_ROLES).
  it.each(["owner", "admin", "cashier"])("rôle éligible (%s) → collect() délègue bien à recordCashPayment", async (role) => {
    const prisma = createFakePrisma({
      invoice: { id: INVOICE_ID, organizationId: ORG_ID, number: "FG-2026-000001", status: "issued", amountDue: 500_000n },
    });
    const organizationsService = createFakeOrganizationsService({
      listMine: vi.fn().mockResolvedValue([{ id: ORG_ID, role }]),
    });
    const paymentsService = createFakePaymentsService();
    const service = new UssdCashCollectionService(prisma as any, organizationsService as any, paymentsService as any);

    await service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID);

    expect(paymentsService.recordCashPayment).toHaveBeenCalledTimes(1);
  });

  it("facture introuvable → NotFoundException", async () => {
    const prisma = createFakePrisma({ invoice: null });
    const organizationsService = createFakeOrganizationsService({
      listMine: vi.fn().mockResolvedValue([{ id: ORG_ID, role: "cashier" }]),
    });
    const service = new UssdCashCollectionService(prisma as any, organizationsService as any, createFakePaymentsService() as any);

    await expect(service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID)).rejects.toThrow(NotFoundException);
  });

  // Critère de done explicite du plan — non-fuite cross-org, capacité 3
  // (encaissement), même invoiceId dans DEUX organisations distinctes :
  // collect() ne doit jamais lire/encaisser la facture de l'AUTRE
  // organisation, même quand l'appelant est légitimement éligible (cashier)
  // dans SA PROPRE organisation.
  it("ne fait jamais fuiter/encaisser une facture d'une AUTRE organisation, même avec le même invoiceId (IDOR, chemin ÉCRITURE)", async () => {
    const invoices = [{ id: INVOICE_ID, organizationId: ORG_B, number: "FG-2026-000099", status: "issued", amountDue: 200_000n }];
    const prisma = createRealisticPrismaForCollect(invoices);
    const organizationsService = createFakeOrganizationsService({
      listMine: vi.fn().mockResolvedValue([{ id: ORG_ID, role: "cashier" }]),
    });
    const paymentsService = createFakePaymentsService();
    const service = new UssdCashCollectionService(prisma as any, organizationsService as any, paymentsService as any);

    await expect(service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID)).rejects.toThrow(NotFoundException);
    expect(paymentsService.recordCashPayment).not.toHaveBeenCalled();
  });

  it("facture non payable (paid) → ConflictException", async () => {
    const prisma = createFakePrisma({ invoice: { id: INVOICE_ID, organizationId: ORG_ID, number: "FG-2026-000001", status: "paid", amountDue: 0n } });
    const organizationsService = createFakeOrganizationsService({
      listMine: vi.fn().mockResolvedValue([{ id: ORG_ID, role: "owner" }]),
    });
    const service = new UssdCashCollectionService(prisma as any, organizationsService as any, createFakePaymentsService() as any);

    await expect(service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID)).rejects.toThrow(ConflictException);
  });

  it("facture voided → ConflictException", async () => {
    const prisma = createFakePrisma({ invoice: { id: INVOICE_ID, organizationId: ORG_ID, number: "FG-2026-000001", status: "voided", amountDue: 500_000n } });
    const organizationsService = createFakeOrganizationsService({
      listMine: vi.fn().mockResolvedValue([{ id: ORG_ID, role: "admin" }]),
    });
    const service = new UssdCashCollectionService(prisma as any, organizationsService as any, createFakePaymentsService() as any);

    await expect(service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID)).rejects.toThrow(ConflictException);
  });

  it("montant dû au-delà du seuil de preuve effectif (sans override) → BadRequestException, message exact", async () => {
    const prisma = createFakePrisma({
      invoice: { id: INVOICE_ID, organizationId: ORG_ID, number: "FG-2026-000001", status: "issued", amountDue: 200_000_000n },
      organization: { id: ORG_ID, commissionBypassProofThresholdOverrideGnf: null },
    });
    const organizationsService = createFakeOrganizationsService({
      listMine: vi.fn().mockResolvedValue([{ id: ORG_ID, role: "cashier" }]),
    });
    const paymentsService = createFakePaymentsService();
    const service = new UssdCashCollectionService(prisma as any, organizationsService as any, paymentsService as any);

    await expect(service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID)).rejects.toThrow(
      new BadRequestException("Au-delà de 1 000 000 GNF, encaissez depuis l'application avec preuve."),
    );
    expect(paymentsService.recordCashPayment).not.toHaveBeenCalled();
  });

  it("montant dû au-delà du seuil ABAISSÉ par organisation (commissionBypassProofThresholdOverrideGnf) → BadRequestException", async () => {
    const prisma = createFakePrisma({
      invoice: { id: INVOICE_ID, organizationId: ORG_ID, number: "FG-2026-000001", status: "issued", amountDue: 60_000_000n },
      organization: { id: ORG_ID, commissionBypassProofThresholdOverrideGnf: 50_000_000n },
    });
    const organizationsService = createFakeOrganizationsService({
      listMine: vi.fn().mockResolvedValue([{ id: ORG_ID, role: "cashier" }]),
    });
    const service = new UssdCashCollectionService(prisma as any, organizationsService as any, createFakePaymentsService() as any);

    await expect(service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID)).rejects.toThrow(
      new BadRequestException("Au-delà de 500 000 GNF, encaissez depuis l'application avec preuve."),
    );
  });

  it("montant dû ≤ seuil effectif → délègue à recordCashPayment avec collectionChannel 'ussd' et l'idempotencyKey exact ussd-cash:${sessionId}", async () => {
    const prisma = createFakePrisma({
      invoice: { id: INVOICE_ID, organizationId: ORG_ID, number: "FG-2026-000001", status: "issued", amountDue: 500_000n },
    });
    const organizationsService = createFakeOrganizationsService({
      listMine: vi.fn().mockResolvedValue([{ id: ORG_ID, role: "cashier" }]),
    });
    const paymentsService = createFakePaymentsService();
    const service = new UssdCashCollectionService(prisma as any, organizationsService as any, paymentsService as any);

    const result = await service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID);

    expect(paymentsService.recordCashPayment).toHaveBeenCalledWith(
      INVOICE_ID,
      ORG_ID,
      { amount: 500_000n, method: "cash" },
      `ussd-cash:${SESSION_ID}`,
      "ussd",
    );
    expect(result.message).toContain("FG-2026-000001");
  });

  it("deux appels avec le même sessionId produisent la MÊME idempotencyKey → un seul Payment créé (dédoublonnage délégué à PaymentsService)", async () => {
    const prisma = createFakePrisma({
      invoice: { id: INVOICE_ID, organizationId: ORG_ID, number: "FG-2026-000001", status: "issued", amountDue: 500_000n },
    });
    const organizationsService = createFakeOrganizationsService({
      listMine: vi.fn().mockResolvedValue([{ id: ORG_ID, role: "cashier" }]),
    });
    const paymentsService = createIdempotentFakePaymentsService();
    const service = new UssdCashCollectionService(prisma as any, organizationsService as any, paymentsService as any);

    await Promise.all([
      service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID),
      service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID),
    ]);

    expect(paymentsService.recordCashPayment).toHaveBeenCalledTimes(2);
    const idempotencyKeysUsed = paymentsService.recordCashPayment.mock.calls.map((call: unknown[]) => call[3]);
    expect(new Set(idempotencyKeysUsed).size).toBe(1);
    expect(idempotencyKeysUsed[0]).toBe(`ussd-cash:${SESSION_ID}`);
  });

  // Revue QA — décision d'architecture explicite #6 du plan : "aucun montant
  // n'est stashé dans le contexte [...] amountDue relu à chaud au moment de
  // collect(), jamais une valeur mémorisée à l'étape de sélection". Ce test
  // prouve le comportement bout en bout : previewCollectible() (aperçu affiché
  // au marchand) lit un amountDue, puis un règlement concurrent (simulé) réduit
  // ce même amountDue AVANT que collect() ne soit appelé — collect() doit
  // utiliser la valeur FRAÎCHE, jamais celle vue par l'aperçu.
  it("encaisse le montant amountDue FRAIS au moment de collect(), pas celui vu par previewCollectible avant un règlement concurrent", async () => {
    // État mutable côté "DB" — simule un paiement partiel concurrent survenu
    // entre l'aperçu et la confirmation (amountDue passe de 500_000n à 300_000n).
    let liveAmountDue = 500_000n;
    const prisma = auClientScope({
      invoice: {
        findFirst: vi.fn().mockImplementation(({ where }: any) => {
          if (where.id !== INVOICE_ID || where.organizationId !== ORG_ID) {
            return Promise.resolve(null);
          }
          return Promise.resolve({
            id: INVOICE_ID,
            organizationId: ORG_ID,
            number: "FG-2026-000001",
            status: "issued",
            amountDue: liveAmountDue,
          });
        }),
      },
      organization: {
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: ORG_ID, commissionBypassProofThresholdOverrideGnf: null }),
      },
    });
    const organizationsService = createFakeOrganizationsService({
      listMine: vi.fn().mockResolvedValue([{ id: ORG_ID, role: "cashier" }]),
    });
    const paymentsService = createFakePaymentsService();
    const service = new UssdCashCollectionService(prisma as any, organizationsService as any, paymentsService as any);

    // Aperçu affiché au marchand — lit 500_000n (previewCollectible n'est
    // jamais mémorisé par collect(), c'est une lecture indépendante).
    const preview = await service.previewCollectible(ORG_ID, INVOICE_ID);
    expect(preview?.amountDue).toBe(500_000n);

    // Règlement concurrent (autre canal, ex. dashboard PWA) survenu entre
    // l'aperçu et la confirmation cash côté USSD.
    liveAmountDue = 300_000n;

    const result = await service.collect(SESSION_ID, INVOICE_ID, ORG_ID, USER_ID);

    expect(paymentsService.recordCashPayment).toHaveBeenCalledWith(
      INVOICE_ID,
      ORG_ID,
      { amount: 300_000n, method: "cash" },
      `ussd-cash:${SESSION_ID}`,
      "ussd",
    );
    expect(result.message).toContain("3 000 GNF");
    expect(result.message).not.toContain("5 000 GNF");
  });
});
