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
import { maskPhoneRgpd, UssdInvoiceListService } from "./ussd-invoice-list.service";

const ORG_ID = "org-1";

function createFakePrisma(invoices: any[] = []) {
  return auClientScope({ invoice: { findMany: vi.fn().mockResolvedValue(invoices) } });
}

// Revue post-fix #3 — un fake Prisma qui APPLIQUE réellement le filtrage
// décrit par `where` sur un jeu de données en mémoire, contrairement à
// createFakePrisma ci-dessus (qui renvoie n'importe quelle liste préparée,
// que le service ait ou non correctement scopé sa requête). Nécessaire pour
// prouver l'absence d'IDOR : un mock qui vérifie seulement la FORME du where
// passerait même si organizationId était oublié dans le code du service.
function createScopedFakePrisma(invoices: any[]) {
  return auClientScope({
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
  });
}

describe("UssdInvoiceListService — mes factures (§2.3 Spec USSD)", () => {
  it("filtre sur documentType invoice et les statuts affichables, limite à 5, plus récentes d'abord, inclut le téléphone client brut (masqué ensuite, jamais renvoyé tel quel)", async () => {
    const prisma = createFakePrisma([{ id: "inv-1", customer: null }]);
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
      include: { customer: { select: { phone: true } } },
    });
  });

  it("retourne la liste avec customerPhoneMasked à la place du customer brut", async () => {
    const invoices = [
      { id: "inv-1", customer: { phone: "+224620123233" } },
      { id: "inv-2", customer: null },
    ];
    const prisma = createFakePrisma(invoices);
    const service = new UssdInvoiceListService(prisma as any);

    await expect(service.listRecent(ORG_ID)).resolves.toEqual([
      { id: "inv-1", customerPhoneMasked: "620***233" },
      { id: "inv-2", customerPhoneMasked: null },
    ]);
  });

  // Critère de done explicite du plan — assertion de FORME, pas seulement de
  // comportement : aucune clé `customer`/`phone` en clair ne doit apparaître
  // dans la valeur de retour.
  it("ne renvoie jamais Customer.phone en clair (assertion de forme)", async () => {
    const invoices = [{ id: "inv-1", customer: { phone: "+224620123233" } }];
    const prisma = createFakePrisma(invoices);
    const service = new UssdInvoiceListService(prisma as any);

    const result = await service.listRecent(ORG_ID);

    expect(result[0]).not.toHaveProperty("customer");
    expect(JSON.stringify(result)).not.toContain("620123233");
    expect(JSON.stringify(result)).toContain("620***233");
  });
});

// K3, §2.6.2 Spec USSD — Option 6.2 "Statut de validation" : EXPOSE le champ
// validatedByAdministration déjà positionné par
// PublicBuyerPortalService.validateLiquidation() (J1, ADR-080/081/098), ne
// reconstruit aucune logique de validation. Jamais de donnée Trésor (Niveau 3,
// ADR-086) — hors scope, non construit. Inchangé par la capacité 2 (masquage
// RGPD) — ce chemin n'a jamais exposé Customer.phone.
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

// Capacité 2, C3 — masquage RGPD du téléphone client dans l'historique
// marchand (plan 2026-09-16-ussd-flash-recherche-encaissement-cash.md).
describe("maskPhoneRgpd — masquage RGPD du téléphone client (capacité 2)", () => {
  it("masque un numéro à 9 chiffres locaux, format PM 620***233 (+224 retiré avant masquage)", () => {
    expect(maskPhoneRgpd("+224620123233")).toBe("620***233");
  });

  it("masque un numéro à 8 chiffres locaux", () => {
    expect(maskPhoneRgpd("+22462012323")).toBe("620**323");
  });

  it("null → null", () => {
    expect(maskPhoneRgpd(null)).toBeNull();
  });

  it("chaîne vide → null", () => {
    expect(maskPhoneRgpd("")).toBeNull();
  });

  it("chaîne courte (partie locale ≤ 6 chiffres) → entièrement masquée, jamais de chevauchement préfixe/suffixe", () => {
    expect(maskPhoneRgpd("+224123")).toBe("***");
  });

  // Revue QA — borne exacte "≤6 → tout masqué" vs "7+ → préfixe/milieu/suffixe",
  // jamais testée pile sur les deux valeurs qui l'encadrent.
  it("partie locale à exactement 6 chiffres → entièrement masquée (dernière valeur de la borne ≤6)", () => {
    expect(maskPhoneRgpd("+224123456")).toBe("******");
  });

  it("partie locale à exactement 7 chiffres → préfixe(3) + 1 astérisque + suffixe(3) (première valeur au-delà de la borne)", () => {
    expect(maskPhoneRgpd("+2241234567")).toBe("123*567");
  });

  it("numéro SANS préfixe +224 → masqué comme s'il s'agissait déjà de la partie locale", () => {
    expect(maskPhoneRgpd("620123233")).toBe("620***233");
  });

  // Comportement documenté (pas un bug) : seul le préfixe +224 est reconnu et
  // retiré. Un numéro international non-guinéen n'est jamais reconnu comme tel
  // ("+33..." ne commence pas par "+224") — il est masqué comme n'importe quelle
  // chaîne : 3 premiers + 3 derniers caractères visibles, y compris le "+" et le
  // code pays. À signaler si un jour ce canal doit aussi accepter des numéros
  // internationaux (MSISDN_FORMAT ne l'autorise pas aujourd'hui, +224 strict).
  it("numéro international non-guinéen (+33...) — pas de préfixe reconnu, masqué tel quel (comportement documenté)", () => {
    expect(maskPhoneRgpd("+33612345678")).toBe("+33******678");
  });
});
