import { describe, expect, it, vi } from "vitest";
import { UssdInvoiceService } from "./ussd-invoice.service";

const USER_ID = "user-1";
const ORG_ID = "org-1";
const PHONE = "+224622334455";

function createFakePrisma(overrides: { customer?: any; findManyResult?: any[] } = {}) {
  return {
    customer: {
      findFirst: vi.fn().mockResolvedValue(overrides.customer ?? null),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "customer-1", ...data })),
      findMany: vi.fn().mockResolvedValue(overrides.findManyResult ?? []),
    },
  };
}

// Revue post-fix #3 — un fake Prisma qui APPLIQUE réellement le filtrage
// décrit par `where` sur un jeu de données en mémoire, contrairement à
// createFakePrisma ci-dessus (findManyResult renvoie n'importe quelle liste
// préparée, que le service ait ou non correctement scopé sa requête).
// Nécessaire pour prouver l'absence d'IDOR : un mock qui vérifie seulement
// la FORME du where passerait même si organizationId était oublié dans le
// code du service.
function createScopedCustomerFakePrisma(customers: any[]) {
  return {
    customer: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn().mockImplementation(({ where, orderBy, take }: any) => {
        let result = customers.filter((c) => c.organizationId === where.organizationId);
        if (where.isPublicEntity !== undefined) {
          result = result.filter((c) => c.isPublicEntity === where.isPublicEntity);
        }
        if (orderBy?.createdAt === "asc") {
          result = [...result].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        }
        if (typeof take === "number") {
          result = result.slice(0, take);
        }
        return Promise.resolve(result);
      }),
    },
  };
}

function createFakeOrganizationsService(memberships: any[] = []) {
  return { listMine: vi.fn().mockResolvedValue(memberships) };
}

function createFakeInvoicesService() {
  return {
    createDraft: vi.fn().mockResolvedValue({ id: "inv-1" }),
    issue: vi.fn().mockResolvedValue({ id: "inv-1", number: "FG-2026-000001", certificationId: "GN-GN123456-2026-ABCDEF" }),
  };
}

function createFakeVelocityTier(overrides: { assertWithinLimits?: ReturnType<typeof vi.fn> } = {}) {
  return { assertWithinLimits: overrides.assertWithinLimits ?? vi.fn().mockResolvedValue(undefined) };
}

describe("UssdInvoiceService — résolution de l'organisation d'émission", () => {
  it("retourne le hint fourni tel quel (chemin code compte, déjà validé)", async () => {
    const service = new UssdInvoiceService(
      createFakePrisma() as any,
      createFakeOrganizationsService() as any,
      createFakeInvoicesService() as any,
      createFakeVelocityTier() as any,
    );

    const result = await service.resolveOrganizationForEmission(USER_ID, ORG_ID);

    expect(result).toBe(ORG_ID);
  });

  it("résout via le premier membership avec un rôle habilité à émettre", async () => {
    const organizations = createFakeOrganizationsService([
      { id: "org-viewer", role: "client_portal" },
      { id: "org-cashier", role: "cashier" },
    ]);
    const service = new UssdInvoiceService(createFakePrisma() as any, organizations as any, createFakeInvoicesService() as any, createFakeVelocityTier() as any);

    const result = await service.resolveOrganizationForEmission(USER_ID);

    expect(result).toBe("org-cashier");
  });

  it("retourne null si aucun membership n'a de rôle habilité", async () => {
    const organizations = createFakeOrganizationsService([{ id: "org-viewer", role: "client_portal" }]);
    const service = new UssdInvoiceService(createFakePrisma() as any, organizations as any, createFakeInvoicesService() as any, createFakeVelocityTier() as any);

    await expect(service.resolveOrganizationForEmission(USER_ID)).resolves.toBeNull();
  });
});

describe("UssdInvoiceService — résolution/création du client (C9, notification automatique)", () => {
  it("retourne undefined si aucun téléphone n'est fourni", async () => {
    const prisma = createFakePrisma();
    const service = new UssdInvoiceService(prisma as any, createFakeOrganizationsService() as any, createFakeInvoicesService() as any, createFakeVelocityTier() as any);

    await expect(service.resolveOrCreateCustomer(ORG_ID, undefined)).resolves.toBeUndefined();
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it("réutilise un client existant portant déjà ce téléphone", async () => {
    const prisma = createFakePrisma({ customer: { id: "customer-existing", phone: PHONE } });
    const service = new UssdInvoiceService(prisma as any, createFakeOrganizationsService() as any, createFakeInvoicesService() as any, createFakeVelocityTier() as any);

    const result = await service.resolveOrCreateCustomer(ORG_ID, PHONE);

    expect(result).toBe("customer-existing");
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("crée un client à la volée si aucun n'existe pour ce téléphone", async () => {
    const prisma = createFakePrisma({ customer: null });
    const service = new UssdInvoiceService(prisma as any, createFakeOrganizationsService() as any, createFakeInvoicesService() as any, createFakeVelocityTier() as any);

    const result = await service.resolveOrCreateCustomer(ORG_ID, PHONE);

    expect(result).toBe("customer-1");
    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: { organizationId: ORG_ID, name: PHONE, phone: PHONE },
    });
  });
});

describe("UssdInvoiceService — émission (D1, §2.4 Spec USSD)", () => {
  it("crée une facture à une seule ligne 'Vente USSD' puis l'émet immédiatement", async () => {
    const invoicesService = createFakeInvoicesService();
    const service = new UssdInvoiceService(createFakePrisma() as any, createFakeOrganizationsService() as any, invoicesService as any, createFakeVelocityTier() as any);

    const result = await service.emitInvoice(ORG_ID, 500_000n, "customer-1");

    expect(invoicesService.createDraft).toHaveBeenCalledWith(
      {
        organizationId: ORG_ID,
        documentType: "invoice",
        customerId: "customer-1",
        lines: [{ description: "Vente USSD", quantity: 1, unitPrice: 500_000n }],
        discountPct: 0,
        // Lot C — Option 4 (vente ordinaire) : cadre standard.
        cadreFacturation: "standard",
      },
      // Lot D — canal 'ussd' posé côté serveur, jamais déduit d'un DTO.
      "ussd",
    );
    expect(invoicesService.issue).toHaveBeenCalledWith("inv-1");
    expect(result.number).toBe("FG-2026-000001");
  });

  it("émet sans customerId quand aucun téléphone n'a été saisi", async () => {
    const invoicesService = createFakeInvoicesService();
    const service = new UssdInvoiceService(createFakePrisma() as any, createFakeOrganizationsService() as any, invoicesService as any, createFakeVelocityTier() as any);

    await service.emitInvoice(ORG_ID, 500_000n, undefined);

    expect(invoicesService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: undefined }),
      "ussd",
    );
  });

  it("vérifie les plafonds de vélocité AVANT de créer le brouillon (D4)", async () => {
    const invoicesService = createFakeInvoicesService();
    const velocityTier = createFakeVelocityTier();
    const service = new UssdInvoiceService(createFakePrisma() as any, createFakeOrganizationsService() as any, invoicesService as any, velocityTier as any);

    await service.emitInvoice(ORG_ID, 500_000n, undefined);

    expect(velocityTier.assertWithinLimits).toHaveBeenCalledWith(ORG_ID, 500_000n);
  });

  it("ne crée aucun brouillon si le plafond de vélocité est dépassé", async () => {
    const invoicesService = createFakeInvoicesService();
    const velocityTier = createFakeVelocityTier({
      assertWithinLimits: vi.fn().mockRejectedValue(new Error("plafond dépassé")),
    });
    const service = new UssdInvoiceService(createFakePrisma() as any, createFakeOrganizationsService() as any, invoicesService as any, velocityTier as any);

    await expect(service.emitInvoice(ORG_ID, 500_000n, undefined)).rejects.toThrow(/plafond/);
    expect(invoicesService.createDraft).not.toHaveBeenCalled();
  });

  // K3, §2.6.1 Spec USSD — Option 6 réutilise emitInvoice() tel quel, jamais un
  // second chemin d'émission parallèle (contrainte explicite de la story).
  it("transmet referenceMarche à createDraft quand fourni (K3, ADR-090)", async () => {
    const invoicesService = createFakeInvoicesService();
    const service = new UssdInvoiceService(createFakePrisma() as any, createFakeOrganizationsService() as any, invoicesService as any, createFakeVelocityTier() as any);

    await service.emitInvoice(ORG_ID, 500_000n, "customer-1", "TELEMO-2026-000123");

    expect(invoicesService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ referenceMarche: "TELEMO-2026-000123" }),
      "ussd",
    );
  });

  it("sans referenceMarche, le comportement reste strictement identique à l'Option 4 — non-régression", async () => {
    const invoicesService = createFakeInvoicesService();
    const service = new UssdInvoiceService(createFakePrisma() as any, createFakeOrganizationsService() as any, invoicesService as any, createFakeVelocityTier() as any);

    await service.emitInvoice(ORG_ID, 500_000n, "customer-1");

    expect(invoicesService.createDraft).toHaveBeenCalledWith(
      {
        organizationId: ORG_ID,
        documentType: "invoice",
        customerId: "customer-1",
        lines: [{ description: "Vente USSD", quantity: 1, unitPrice: 500_000n }],
        discountPct: 0,
        referenceMarche: undefined,
        cadreFacturation: "standard",
      },
      "ussd",
    );
  });

  it("Option 6 : cadre 'marche_public' transmis à createDraft (Lot C)", async () => {
    const invoicesService = createFakeInvoicesService();
    const service = new UssdInvoiceService(createFakePrisma() as any, createFakeOrganizationsService() as any, invoicesService as any, createFakeVelocityTier() as any);

    await service.emitInvoice(ORG_ID, 500_000n, "customer-1", "TELEMO-2026-000123", "marche_public");

    expect(invoicesService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ cadreFacturation: "marche_public", referenceMarche: "TELEMO-2026-000123" }),
      "ussd",
    );
  });
});

// K3, §2.6.1 Spec USSD — Option 6 sélectionne parmi les clients déjà marqués
// entité publique (F16, ADR-105) : la session condensée USSD ne crée jamais ce
// rattachement elle-même (flagPublicEntity() est hors périmètre USSD, §6 Spec).
describe("UssdInvoiceService — clients entité publique déjà rattachés (K3, décision 1)", () => {
  it("filtre les clients de l'organisation marqués isPublicEntity, jamais les autres", async () => {
    const prisma = createFakePrisma({
      findManyResult: [{ id: "customer-public-1", name: "Ministère du Plan" }],
    });
    const service = new UssdInvoiceService(prisma as any, createFakeOrganizationsService() as any, createFakeInvoicesService() as any, createFakeVelocityTier() as any);

    const result = await service.listPublicEntityCustomers(ORG_ID);

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG_ID, isPublicEntity: true } }),
    );
    expect(result).toEqual([{ id: "customer-public-1", name: "Ministère du Plan" }]);
  });

  it("liste vide si aucun client de l'organisation n'est encore marqué entité publique", async () => {
    const prisma = createFakePrisma({ findManyResult: [] });
    const service = new UssdInvoiceService(prisma as any, createFakeOrganizationsService() as any, createFakeInvoicesService() as any, createFakeVelocityTier() as any);

    await expect(service.listPublicEntityCustomers(ORG_ID)).resolves.toEqual([]);
  });

  // Revue post-fix #3 — jusqu'ici les tests ne vérifiaient que la FORME du
  // where transmis à un mock inconditionnellement obéissant. Ici, un vrai
  // jeu de données à 2 organisations, filtré par un fake Prisma qui applique
  // réellement le where (createScopedCustomerFakePrisma) : prouve que
  // l'appel avec organizationId d'une seule organisation exclut bien les
  // clients entité publique de l'autre organisation.
  it("exclut les clients entité publique d'une autre organisation (IDOR)", async () => {
    const customers = [
      { id: "cust-org-a", organizationId: "org-a", isPublicEntity: true, name: "Ministère A", createdAt: "2026-01-01" },
      { id: "cust-org-b", organizationId: "org-b", isPublicEntity: true, name: "Ministère B", createdAt: "2026-01-02" },
    ];
    const prisma = createScopedCustomerFakePrisma(customers);
    const service = new UssdInvoiceService(
      prisma as any,
      createFakeOrganizationsService() as any,
      createFakeInvoicesService() as any,
      createFakeVelocityTier() as any,
    );

    const result = await service.listPublicEntityCustomers("org-a");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("cust-org-a");
  });
});
