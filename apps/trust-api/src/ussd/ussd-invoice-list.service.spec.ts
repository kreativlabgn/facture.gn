import { describe, expect, it, vi } from "vitest";
import { UssdInvoiceListService } from "./ussd-invoice-list.service";

const ORG_ID = "org-1";

function createFakePrisma(invoices: any[] = []) {
  return { invoice: { findMany: vi.fn().mockResolvedValue(invoices) } };
}

// Revue post-fix #3 — un fake Prisma qui APPLIQUE réellement le filtrage
// décrit par `where` sur un jeu de données en mémoire, contrairement à
// createFakePrisma ci-dessus (qui renvoie n'importe quelle liste préparée,
// que le service ait ou non correctement scopé sa requête). Nécessaire pour
// prouver l'absence d'IDOR : un mock qui vérifie seulement la FORME du where
// passerait même si organizationId était oublié dans le code du service.
function createScopedFakePrisma(invoices: any[]) {
  return {
    invoice: {
      findMany: vi.fn().mockImplementation(({ where, orderBy, take }: any) => {
        let result = invoices.filter((inv) => inv.organizationId === where.organizationId);
        if (where.documentType !== undefined) {
          result = result.filter((inv) => inv.documentType === where.documentType);
        }
        if (where.customer?.isPublicEntity !== undefined) {
          result = result.filter((inv) => inv.customer?.isPublicEntity === where.customer.isPublicEntity);
        }
        if (where.status?.not !== undefined) {
          result = result.filter((inv) => inv.status !== where.status.not);
        }
        if (where.status?.in !== undefined) {
          result = result.filter((inv) => where.status.in.includes(inv.status));
        }
        if (orderBy?.issuedAt === "desc") {
          result = [...result].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
        }
        if (typeof take === "number") {
          result = result.slice(0, take);
        }
        return Promise.resolve(result);
      }),
    },
  };
}

describe("UssdInvoiceListService — mes factures (§2.3 Spec USSD)", () => {
  it("filtre sur documentType invoice et les statuts affichables, limite à 5, plus récentes d'abord", async () => {
    const prisma = createFakePrisma([{ id: "inv-1" }]);
    const service = new UssdInvoiceListService(prisma as any);

    await service.listRecent(ORG_ID);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        documentType: "invoice",
        status: { in: ["issued", "partially_paid", "paid", "voided"] },
      },
      orderBy: { issuedAt: "desc" },
      take: 5,
    });
  });

  it("retourne la liste telle que renvoyée par Prisma", async () => {
    const invoices = [{ id: "inv-1" }, { id: "inv-2" }];
    const prisma = createFakePrisma(invoices);
    const service = new UssdInvoiceListService(prisma as any);

    await expect(service.listRecent(ORG_ID)).resolves.toEqual(invoices);
  });
});

// K3, §2.6.2 Spec USSD — Option 6.2 "Statut de validation" : EXPOSE le champ
// validatedByAdministration déjà positionné par
// PublicBuyerPortalService.validateLiquidation() (J1, ADR-080/081/098), ne
// reconstruit aucune logique de validation. Jamais de donnée Trésor (Niveau 3,
// ADR-086) — hors scope, non construit.
describe("UssdInvoiceListService — statut de validation commande publique (K3, §2.6.2 Spec USSD)", () => {
  it("filtre sur documentType invoice, client entité publique, exclut les brouillons, limite à 5, plus récentes d'abord", async () => {
    const prisma = createFakePrisma([{ id: "inv-1" }]);
    const service = new UssdInvoiceListService(prisma as any);

    await service.listPublicOrderStatus(ORG_ID);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        documentType: "invoice",
        customer: { isPublicEntity: true },
        status: { not: "draft" },
      },
      orderBy: { issuedAt: "desc" },
      take: 5,
    });
  });

  it("retourne la liste telle que renvoyée par Prisma, y compris validatedByAdministration", async () => {
    const invoices = [
      { id: "inv-1", number: "FG-2026-000010", validatedByAdministration: true },
      { id: "inv-2", number: "FG-2026-000011", validatedByAdministration: false },
    ];
    const prisma = createFakePrisma(invoices);
    const service = new UssdInvoiceListService(prisma as any);

    await expect(service.listPublicOrderStatus(ORG_ID)).resolves.toEqual(invoices);
  });

  // Revue post-fix #3 — jusqu'ici les tests ne vérifiaient que la FORME du
  // where transmis à un mock inconditionnellement obéissant. Ici, un vrai
  // jeu de données à 2 organisations, filtré par un fake Prisma qui applique
  // réellement le where (createScopedFakePrisma) : prouve que l'appel avec
  // organizationId d'une seule organisation exclut bien les factures de
  // l'autre, même quand son client est aussi isPublicEntity: true.
  it("exclut les factures d'une autre organisation, même avec customer.isPublicEntity: true (IDOR)", async () => {
    const invoices = [
      {
        id: "inv-org-a",
        organizationId: "org-a",
        documentType: "invoice",
        status: "issued",
        customer: { isPublicEntity: true },
        issuedAt: "2026-08-01",
      },
      {
        id: "inv-org-b",
        organizationId: "org-b",
        documentType: "invoice",
        status: "issued",
        customer: { isPublicEntity: true },
        issuedAt: "2026-08-02",
      },
    ];
    const prisma = createScopedFakePrisma(invoices);
    const service = new UssdInvoiceListService(prisma as any);

    const result = await service.listPublicOrderStatus("org-a");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("inv-org-a");
  });
});
