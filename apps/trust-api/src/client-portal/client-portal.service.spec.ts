import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ClientPortalService } from "./client-portal.service";

const USER_ID = "user-1";
const PHONE = "+224622334455";

function createFakePrisma(overrides: any = {}) {
  const phones = overrides.phones ?? [{ msisdn: PHONE, verifiedAt: new Date() }];
  const allCustomers = overrides.customers ?? [];
  const prisma: any = {
    userPhone: {
      // Simule réellement le filtre verifiedAt:{not:null} de la vraie requête —
      // un mock qui renverrait la fixture telle quelle ne prouverait rien sur le
      // comportement réel (même piège déjà corrigé pour Mandate.expiresAt,
      // Quality Audit 2026-08-23, revue post-fix).
      findMany: vi.fn().mockResolvedValue(phones.filter((p: { verifiedAt: Date | null }) => p.verifiedAt !== null)),
    },
    customer: {
      // F13, revue post-fix #5 — simule réellement le `where: {phone:{in:[...]}}`
      // de la vraie requête plutôt que de renvoyer `allCustomers` tel quel : un
      // mock qui ignore l'argument ne prouverait rien sur la résolution réelle
      // "téléphone vérifié → clients de plusieurs organisations".
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        const phoneSet = new Set(where.phone.in as string[]);
        return Promise.resolve(allCustomers.filter((c: { phone?: string }) => phoneSet.has(c.phone as string)));
      }),
      findUnique: vi.fn().mockResolvedValue(overrides.customer ?? null),
    },
    invoice: {
      groupBy: vi.fn().mockResolvedValue(overrides.balances ?? []),
      findMany: vi.fn().mockResolvedValue(overrides.invoices ?? []),
    },
  };
  return prisma;
}

describe("ClientPortalService", () => {
  describe("listOrganizations", () => {
    it("retourne un tableau vide si aucun numéro vérifié n'est associé à ce compte", async () => {
      const prisma = createFakePrisma({ phones: [] });
      const service = new ClientPortalService(prisma);

      const result = await service.listOrganizations(USER_ID);

      expect(result).toEqual([]);
      expect(prisma.customer.findMany).not.toHaveBeenCalled();
    });

    it("ignore les numéros non vérifiés — jamais de résolution sur un msisdn non prouvé", async () => {
      const prisma = createFakePrisma({ phones: [{ msisdn: PHONE, verifiedAt: null }] });
      const service = new ClientPortalService(prisma);

      await service.listOrganizations(USER_ID);

      expect(prisma.customer.findMany).not.toHaveBeenCalled();
    });

    it("agrège le solde dû par un seul groupBy (pas N appels par organisation) et renvoie name/runningBalance/creditLimit par organisation", async () => {
      const customers = [
        { id: "cust-1", organizationId: "org-1", phone: PHONE, creditLimit: 500_000n, organization: { id: "org-1", name: "Boutique Mariama" } },
        { id: "cust-2", organizationId: "org-2", phone: PHONE, creditLimit: null, organization: { id: "org-2", name: "Atelier Sekou" } },
      ];
      const balances = [{ customerId: "cust-1", _sum: { amountDue: 120_000n } }];
      const prisma = createFakePrisma({ customers, balances });
      const service = new ClientPortalService(prisma);

      const result = await service.listOrganizations(USER_ID);

      expect(prisma.invoice.groupBy).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        { organizationId: "org-1", organizationName: "Boutique Mariama", customerId: "cust-1", runningBalance: 120_000n, creditLimit: 500_000n },
        { organizationId: "org-2", organizationName: "Atelier Sekou", customerId: "cust-2", runningBalance: 0n, creditLimit: null },
      ]);
    });

    it("F13, revue post-fix #5 — résout réellement via le téléphone vérifié, jamais un autre client non lié au même numéro", async () => {
      const customers = [
        { id: "cust-1", organizationId: "org-1", phone: PHONE, creditLimit: null, organization: { id: "org-1", name: "Boutique Mariama" } },
        { id: "cust-autre", organizationId: "org-3", phone: "+224699999999", creditLimit: null, organization: { id: "org-3", name: "Autre Client" } },
      ];
      const prisma = createFakePrisma({ customers });
      const service = new ClientPortalService(prisma);

      const result = await service.listOrganizations(USER_ID);

      expect(result).toHaveLength(1);
      expect(result[0].organizationName).toBe("Boutique Mariama");
      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { phone: { in: [PHONE] } } }),
      );
    });
  });

  describe("listInvoices", () => {
    it("rejette (404) un customerId qui n'existe pas — jamais une confirmation d'existence à un appelant non autorisé", async () => {
      const prisma = createFakePrisma({ customer: null });
      const service = new ClientPortalService(prisma);

      await expect(service.listInvoices(USER_ID, "cust-inconnu", {})).rejects.toThrow(NotFoundException);
    });

    it("rejette (404) un customerId dont le téléphone ne correspond à AUCUN numéro vérifié de l'appelant — IDOR", async () => {
      const prisma = createFakePrisma({
        customer: { id: "cust-1", organizationId: "org-1", phone: "+224699000000" },
        phones: [{ msisdn: PHONE, verifiedAt: new Date() }],
      });
      const service = new ClientPortalService(prisma);

      await expect(service.listInvoices(USER_ID, "cust-1", {})).rejects.toThrow(NotFoundException);
      expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    });

    it("liste les factures paginées du client une fois le téléphone confirmé, exclut draft/voided (F13, revue post-fix #1)", async () => {
      const prisma = createFakePrisma({
        customer: { id: "cust-1", organizationId: "org-1", phone: PHONE },
        phones: [{ msisdn: PHONE, verifiedAt: new Date() }],
        invoices: [{ id: "inv-1" }],
      });
      const service = new ClientPortalService(prisma);

      const result = await service.listInvoices(USER_ID, "cust-1", { take: 10, skip: 0 });

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: "cust-1", organizationId: "org-1", status: { notIn: ["draft", "voided"] } },
          take: 10,
          skip: 0,
        }),
      );
      expect(result).toEqual([{ id: "inv-1" }]);
    });

    it("une facture draft du même client n'apparaît jamais dans le résultat (F13, revue post-fix #1)", async () => {
      // Le mock invoice.findMany renvoie ici tel quel ce que le fake fournit — la
      // preuve porte sur l'ARGUMENT réellement transmis à Prisma (status:notIn),
      // pas sur un filtrage fait côté test qui masquerait un oubli du service.
      const prisma = createFakePrisma({
        customer: { id: "cust-1", organizationId: "org-1", phone: PHONE },
        phones: [{ msisdn: PHONE, verifiedAt: new Date() }],
        invoices: [{ id: "inv-issued", status: "issued" }],
      });
      const service = new ClientPortalService(prisma);

      await service.listInvoices(USER_ID, "cust-1", {});

      const call = prisma.invoice.findMany.mock.calls[0][0];
      expect(call.where.status).toEqual({ notIn: ["draft", "voided"] });
    });

    it("plafonne la taille de page comme le reste du repo (MAX_LIST_PAGE_SIZE)", async () => {
      const prisma = createFakePrisma({
        customer: { id: "cust-1", organizationId: "org-1", phone: PHONE },
        phones: [{ msisdn: PHONE, verifiedAt: new Date() }],
      });
      const service = new ClientPortalService(prisma);

      await service.listInvoices(USER_ID, "cust-1", { take: 500 });

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    });
  });
});
