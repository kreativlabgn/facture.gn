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
import { UssdInvoiceSearchService } from "./ussd-invoice-search.service";

const ORG_A = "org-a";
const ORG_B = "org-b";
const PHONE = "+224622334455";
const AMOUNT = 500_000n; // centimes GNF

const TODAY = new Date("2026-09-16T14:00:00.000Z");
const TODAY_START_OF_DAY = new Date("2026-09-16T00:00:00.000Z");
const TODAY_LAST_SECOND = new Date("2026-09-16T23:59:59.000Z");
const TOMORROW_START = new Date("2026-09-17T00:00:00.000Z");
const YESTERDAY = new Date("2026-09-15T23:59:59.000Z");

// Fake qui APPLIQUE réellement les critères du `where` sur un jeu de données en
// mémoire — nécessaire pour prouver la non-fuite cross-org, pas seulement la
// FORME du where transmis à un mock inconditionnellement obéissant.
function createRealisticPrisma(invoices: any[]) {
  return auClientScope({
    invoice: {
      findMany: vi.fn().mockImplementation(({ where, orderBy, take }: any) => {
        let result = invoices.filter((inv) => inv.organizationId === where.organizationId);
        result = result.filter((inv) => inv.documentType === where.documentType);
        result = result.filter((inv) => where.status.in.includes(inv.status));
        result = result.filter((inv) => inv.totalTtc === where.totalTtc);
        result = result.filter((inv) => inv.issuedAt >= where.issuedAt.gte && inv.issuedAt < where.issuedAt.lt);
        result = result.filter((inv) => inv.customer?.phone === where.customer.phone);
        if (orderBy?.issuedAt === "desc") {
          result = [...result].sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());
        }
        if (typeof take === "number") {
          result = result.slice(0, take);
        }
        return Promise.resolve(result);
      }),
    },
  });
}

function invoiceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    organizationId: ORG_A,
    number: "FG-2026-000001",
    documentType: "invoice",
    status: "issued",
    totalTtc: AMOUNT,
    issuedAt: TODAY,
    customer: { phone: PHONE },
    ...overrides,
  };
}

describe("UssdInvoiceSearchService — recherche composite téléphone + montant (capacité 2)", () => {
  it("0 résultat si aucune facture ne correspond au couple téléphone+montant du jour", async () => {
    const prisma = createRealisticPrisma([]);
    const service = new UssdInvoiceSearchService(prisma as any);
    vi.setSystemTime(TODAY);

    await expect(service.searchByPhoneAndAmount(ORG_A, PHONE, AMOUNT)).resolves.toEqual([]);
    vi.useRealTimers();
  });

  it("1 résultat quand une seule facture correspond", async () => {
    const prisma = createRealisticPrisma([invoiceFixture()]);
    const service = new UssdInvoiceSearchService(prisma as any);
    vi.setSystemTime(TODAY);

    const result = await service.searchByPhoneAndAmount(ORG_A, PHONE, AMOUNT);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("inv-1");
    vi.useRealTimers();
  });

  it("N résultats (dédoublonnage même-jour) quand plusieurs factures identiques ont été émises le même jour, plus récentes d'abord", async () => {
    const invoices = [
      invoiceFixture({ id: "inv-1", issuedAt: new Date("2026-09-16T08:00:00.000Z") }),
      invoiceFixture({ id: "inv-2", issuedAt: new Date("2026-09-16T12:00:00.000Z") }),
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdInvoiceSearchService(prisma as any);
    vi.setSystemTime(TODAY);

    const result = await service.searchByPhoneAndAmount(ORG_A, PHONE, AMOUNT);

    expect(result.map((r: any) => r.id)).toEqual(["inv-2", "inv-1"]);
    vi.useRealTimers();
  });

  it("borne de journée UTC — inclut 23:59:59, exclut J+1 00:00:00 et la veille", async () => {
    const invoices = [
      invoiceFixture({ id: "inv-veille", issuedAt: YESTERDAY }),
      invoiceFixture({ id: "inv-debut-jour", issuedAt: TODAY_START_OF_DAY }),
      invoiceFixture({ id: "inv-fin-jour", issuedAt: TODAY_LAST_SECOND }),
      invoiceFixture({ id: "inv-lendemain", issuedAt: TOMORROW_START }),
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdInvoiceSearchService(prisma as any);
    vi.setSystemTime(TODAY);

    const result = await service.searchByPhoneAndAmount(ORG_A, PHONE, AMOUNT);

    expect(result.map((r: any) => r.id).sort()).toEqual(["inv-debut-jour", "inv-fin-jour"]);
    vi.useRealTimers();
  });

  // Revue QA — décision d'architecture explicite du plan (point 3) : le montant
  // comparé est totalTtc, PAS amountDue. Une facture partially_paid dont le
  // solde restant (amountDue) ne correspond PLUS au montant recherché doit
  // quand même matcher, tant que son totalTtc (montant d'origine) correspond —
  // et inversement, chercher sur amountDue ne doit renvoyer aucun résultat.
  it("compare sur totalTtc, jamais amountDue — une facture partially_paid avec totalTtc≠amountDue matche sur totalTtc", async () => {
    const invoices = [
      invoiceFixture({
        id: "inv-partial",
        status: "partially_paid",
        totalTtc: AMOUNT, // 500_000n — le montant recherché
        amountDue: 120_000n, // solde restant, DIFFÉRENT du montant recherché
      }),
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdInvoiceSearchService(prisma as any);
    vi.setSystemTime(TODAY);

    const result = await service.searchByPhoneAndAmount(ORG_A, PHONE, AMOUNT);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("inv-partial");
    vi.useRealTimers();
  });

  it("ne matche jamais sur amountDue — chercher le solde restant (au lieu du totalTtc d'origine) ne renvoie rien", async () => {
    const invoices = [
      invoiceFixture({
        id: "inv-partial",
        status: "partially_paid",
        totalTtc: 500_000n,
        amountDue: 120_000n,
      }),
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdInvoiceSearchService(prisma as any);
    vi.setSystemTime(TODAY);

    // Recherche sur 120_000n (amountDue, le solde restant) — ne doit rien trouver
    // puisque la comparaison porte sur totalTtc (500_000n), pas amountDue.
    await expect(service.searchByPhoneAndAmount(ORG_A, PHONE, 120_000n)).resolves.toEqual([]);
    vi.useRealTimers();
  });

  it("documentType invoice strict — jamais une proforma/devis, même téléphone+montant+jour identiques", async () => {
    const invoices = [invoiceFixture({ id: "inv-proforma", documentType: "proforma" })];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdInvoiceSearchService(prisma as any);
    vi.setSystemTime(TODAY);

    await expect(service.searchByPhoneAndAmount(ORG_A, PHONE, AMOUNT)).resolves.toEqual([]);
    vi.useRealTimers();
  });

  // Critère de done explicite du plan — non-fuite cross-org, même couple
  // téléphone+montant dans DEUX organisations distinctes.
  it("ne fait JAMAIS fuiter la facture d'une autre organisation, même avec un couple téléphone+montant identique (IDOR)", async () => {
    const invoices = [
      invoiceFixture({ id: "inv-org-a", organizationId: ORG_A }),
      invoiceFixture({ id: "inv-org-b", organizationId: ORG_B }),
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdInvoiceSearchService(prisma as any);
    vi.setSystemTime(TODAY);

    const result = await service.searchByPhoneAndAmount(ORG_A, PHONE, AMOUNT);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("inv-org-a");
    vi.useRealTimers();
  });

  it("limite le nombre de résultats à MAX_RESULTS (réutilise la constante partagée avec listRecent)", async () => {
    const invoices = Array.from({ length: 8 }, (_, i) =>
      invoiceFixture({ id: `inv-${i}`, issuedAt: new Date(TODAY.getTime() - i * 1000) }),
    );
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdInvoiceSearchService(prisma as any);
    vi.setSystemTime(TODAY);

    const result = await service.searchByPhoneAndAmount(ORG_A, PHONE, AMOUNT);

    expect(result).toHaveLength(5);
    vi.useRealTimers();
  });
});
