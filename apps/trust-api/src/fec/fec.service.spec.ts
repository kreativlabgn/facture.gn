import { describe, expect, it, vi } from "vitest";
import { OrganizationAccessService } from "../common/rbac/organization-access.service";
import { FecService } from "./fec.service";

const ORG_ID = "org-1";
const USER_ID = "user-1";

function createFakePrisma(overrides: { member?: any; mandate?: any; invoices?: any[] } = {}) {
  const prisma: any = {
    organizationMember: {
      findUnique: vi.fn().mockResolvedValue(overrides.member ?? null),
    },
    mandate: {
      findFirst: vi.fn().mockResolvedValue(overrides.mandate ?? null),
    },
    invoice: {
      findMany: vi.fn().mockResolvedValue(
        overrides.invoices ?? [
          {
            number: "FG-2026-000001",
            issuedAt: new Date("2026-08-01T00:00:00.000Z"),
            totalHt: 2_000_000n,
            totalTva: 0n,
            totalTtc: 2_000_000n,
            payments: [],
          },
        ],
      ),
    },
  };
  return prisma;
}

describe("FecService — autorisation à deux chemins (F9)", () => {
  it("autorise l'owner de l'organisation", async () => {
    const prisma = createFakePrisma({ member: { role: "owner", revokedAt: null } });
    const service = new FecService(prisma as any, new OrganizationAccessService(prisma as any));

    await expect(service.export(ORG_ID, USER_ID)).resolves.toContain("JournalCode");
  });

  it("autorise l'accountant_internal de l'organisation", async () => {
    const prisma = createFakePrisma({ member: { role: "accountant_internal", revokedAt: null } });
    const service = new FecService(prisma as any, new OrganizationAccessService(prisma as any));

    await expect(service.export(ORG_ID, USER_ID)).resolves.toContain("JournalCode");
  });

  it("autorise un tax_controller_readonly invité par l'organisation (F14, ADR-104)", async () => {
    const prisma = createFakePrisma({ member: { role: "tax_controller_readonly", revokedAt: null } });
    const service = new FecService(prisma as any, new OrganizationAccessService(prisma as any));

    await expect(service.export(ORG_ID, USER_ID)).resolves.toContain("JournalCode");
  });

  it("n'interroge jamais Mandate quand OrganizationMember autorise déjà (évite une requête inutile)", async () => {
    const prisma = createFakePrisma({ member: { role: "owner", revokedAt: null } });
    const service = new FecService(prisma as any, new OrganizationAccessService(prisma as any));

    await service.export(ORG_ID, USER_ID);

    expect(prisma.mandate.findFirst).not.toHaveBeenCalled();
  });

  it("autorise un PracticeMember (accountant_external, pas seulement practice_admin) dont la practice détient un mandat active (ADR-070)", async () => {
    const prisma = createFakePrisma({ member: null, mandate: { id: "mandate-1", status: "active" } });
    const service = new FecService(prisma as any, new OrganizationAccessService(prisma as any));

    await expect(service.export(ORG_ID, USER_ID)).resolves.toContain("JournalCode");
    expect(prisma.mandate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          status: "active",
          practice: { members: { some: { userId: USER_ID, leftAt: null } } },
        }),
      }),
    );
  });

  it("refuse un utilisateur sans OrganizationMember ni mandat actif", async () => {
    const prisma = createFakePrisma({ member: null, mandate: null });
    const service = new FecService(prisma as any, new OrganizationAccessService(prisma as any));

    await expect(service.export(ORG_ID, USER_ID)).rejects.toThrow(/accès/);
  });

  it("refuse un OrganizationMember révoqué (revokedAt renseigné)", async () => {
    const prisma = createFakePrisma({ member: { role: "owner", revokedAt: new Date() }, mandate: null });
    const service = new FecService(prisma as any, new OrganizationAccessService(prisma as any));

    await expect(service.export(ORG_ID, USER_ID)).rejects.toThrow(/accès/);
  });

  it("refuse un cashier (rôle non habilité au FEC)", async () => {
    const prisma = createFakePrisma({ member: { role: "cashier", revokedAt: null }, mandate: null });
    const service = new FecService(prisma as any, new OrganizationAccessService(prisma as any));

    await expect(service.export(ORG_ID, USER_ID)).rejects.toThrow(/accès/);
  });
});

describe("FecService — chargement des factures (F9)", () => {
  it("charge uniquement les factures issued/partially_paid/paid de type invoice, avec leurs payments, de l'exercice fiscal demandé", async () => {
    const prisma = createFakePrisma({ member: { role: "owner", revokedAt: null } });
    const service = new FecService(prisma as any, new OrganizationAccessService(prisma as any));

    await service.export(ORG_ID, USER_ID, 2026);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        documentType: "invoice",
        status: { in: ["issued", "partially_paid", "paid"] },
        issuedAt: { gte: new Date(Date.UTC(2026, 0, 1)), lt: new Date(Date.UTC(2027, 0, 1)) },
      },
      include: { payments: true },
    });
  });

  it("year omis retombe sur l'année en cours (Quality Audit 2026-08-23, finding #7)", async () => {
    const prisma = createFakePrisma({ member: { role: "owner", revokedAt: null } });
    const service = new FecService(prisma as any, new OrganizationAccessService(prisma as any));
    const currentYear = new Date().getFullYear();

    await service.export(ORG_ID, USER_ID);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          issuedAt: { gte: new Date(Date.UTC(currentYear, 0, 1)), lt: new Date(Date.UTC(currentYear + 1, 0, 1)) },
        }),
      }),
    );
  });

  it("le texte final commence par l'en-tête FEC puis les écritures, séparés par des retours à la ligne", async () => {
    const prisma = createFakePrisma({ member: { role: "owner", revokedAt: null } });
    const service = new FecService(prisma as any, new OrganizationAccessService(prisma as any));

    const fec = await service.export(ORG_ID, USER_ID);
    const rows = fec.split("\n");

    expect(rows[0].split("\t")[0]).toBe("JournalCode");
    expect(rows.length).toBeGreaterThan(1);
  });
});
