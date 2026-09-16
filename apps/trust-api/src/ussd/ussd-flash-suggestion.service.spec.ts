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
import { UssdFlashSuggestionService } from "./ussd-flash-suggestion.service";

const PHONE = "+224622334455";
const NOW = new Date("2026-09-16T10:00:00.000Z");
const WITHIN_30_MIN = new Date("2026-09-16T09:45:00.000Z");
const OVER_30_MIN = new Date("2026-09-16T09:00:00.000Z");

// Fake qui APPLIQUE réellement les critères du `where`, sur un jeu de données en
// mémoire, plutôt que de renvoyer aveuglément une liste préparée — nécessaire
// pour prouver que la fenêtre de 30 min, le filtre de statut et
// flashSuggestedAt:null sont bien portés par la requête elle-même, pas
// simplement passés au mock.
function createRealisticPrisma(invoices: any[]) {
  return auClientScope({
    invoice: {
      findFirst: vi.fn().mockImplementation(({ where, orderBy }: any) => {
        let result = invoices.filter((inv) => inv.customer?.phone === where.customer.phone);
        result = result.filter((inv) => inv.documentType === where.documentType);
        result = result.filter((inv) => where.status.in.includes(inv.status));
        result = result.filter((inv) => inv.issuedAt >= where.issuedAt.gte);
        result = result.filter((inv) => inv.flashSuggestedAt === where.flashSuggestedAt);
        if (orderBy?.issuedAt === "desc") {
          result = [...result].sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());
        }
        return Promise.resolve(result[0] ?? null);
      }),
      updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
        const match = invoices.find(
          (inv) => inv.id === where.id && inv.organizationId === where.organizationId && inv.flashSuggestedAt === where.flashSuggestedAt,
        );
        if (!match) {
          return Promise.resolve({ count: 0 });
        }
        match.flashSuggestedAt = data.flashSuggestedAt;
        return Promise.resolve({ count: 1 });
      }),
    },
  });
}

describe("UssdFlashSuggestionService — findCandidate (capacité 1, interception flash)", () => {
  it("trouve une facture issued émise il y a < 30 min pour le téléphone donné, même dans une AUTRE organisation (cross-org, F13/ClientPortalService)", async () => {
    const invoices = [
      {
        id: "inv-1",
        organizationId: "org-autre-que-le-marchand-connecte",
        number: "FG-2026-000001",
        amountDue: 500_000n,
        documentType: "invoice",
        status: "issued",
        issuedAt: WITHIN_30_MIN,
        flashSuggestedAt: null,
        customer: { phone: PHONE },
      },
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdFlashSuggestionService(prisma as any);
    vi.setSystemTime(NOW);

    const candidate = await service.findCandidate(PHONE);

    expect(candidate).toMatchObject({ id: "inv-1", organizationId: "org-autre-que-le-marchand-connecte", number: "FG-2026-000001" });
    vi.useRealTimers();
  });

  it("accepte aussi une facture partially_paid", async () => {
    const invoices = [
      {
        id: "inv-1",
        organizationId: "org-a",
        number: "FG-2026-000002",
        amountDue: 200_000n,
        documentType: "invoice",
        status: "partially_paid",
        issuedAt: WITHIN_30_MIN,
        flashSuggestedAt: null,
        customer: { phone: PHONE },
      },
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdFlashSuggestionService(prisma as any);
    vi.setSystemTime(NOW);

    const candidate = await service.findCandidate(PHONE);

    expect(candidate?.id).toBe("inv-1");
    vi.useRealTimers();
  });

  // Revue QA — borne stricte de la fenêtre de 30 min, jamais testée exactement
  // jusqu'ici (seulement 15 min « dans la fenêtre » / 60 min « hors fenêtre »).
  it("éligible quand émise il y a exactement 29m59s (juste sous la borne)", async () => {
    const invoices = [
      {
        id: "inv-2959",
        organizationId: "org-a",
        number: "FG-2026-000006",
        amountDue: 500_000n,
        documentType: "invoice",
        status: "issued",
        issuedAt: new Date(NOW.getTime() - (30 * 60_000 - 1000)), // 29m59s avant NOW
        flashSuggestedAt: null,
        customer: { phone: PHONE },
      },
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdFlashSuggestionService(prisma as any);
    vi.setSystemTime(NOW);

    const candidate = await service.findCandidate(PHONE);

    expect(candidate?.id).toBe("inv-2959");
    vi.useRealTimers();
  });

  it("non éligible quand émise il y a exactement 30m01s (juste au-delà de la borne)", async () => {
    const invoices = [
      {
        id: "inv-3001",
        organizationId: "org-a",
        number: "FG-2026-000007",
        amountDue: 500_000n,
        documentType: "invoice",
        status: "issued",
        issuedAt: new Date(NOW.getTime() - (30 * 60_000 + 1000)), // 30m01s avant NOW
        flashSuggestedAt: null,
        customer: { phone: PHONE },
      },
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdFlashSuggestionService(prisma as any);
    vi.setSystemTime(NOW);

    await expect(service.findCandidate(PHONE)).resolves.toBeNull();
    vi.useRealTimers();
  });

  it("aucun candidat si la facture a été émise il y a plus de 30 min", async () => {
    const invoices = [
      {
        id: "inv-1",
        organizationId: "org-a",
        number: "FG-2026-000003",
        amountDue: 500_000n,
        documentType: "invoice",
        status: "issued",
        issuedAt: OVER_30_MIN,
        flashSuggestedAt: null,
        customer: { phone: PHONE },
      },
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdFlashSuggestionService(prisma as any);
    vi.setSystemTime(NOW);

    await expect(service.findCandidate(PHONE)).resolves.toBeNull();
    vi.useRealTimers();
  });

  it("aucun candidat si le statut n'est pas éligible (paid)", async () => {
    const invoices = [
      {
        id: "inv-1",
        organizationId: "org-a",
        number: "FG-2026-000004",
        amountDue: 0n,
        documentType: "invoice",
        status: "paid",
        issuedAt: WITHIN_30_MIN,
        flashSuggestedAt: null,
        customer: { phone: PHONE },
      },
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdFlashSuggestionService(prisma as any);
    vi.setSystemTime(NOW);

    await expect(service.findCandidate(PHONE)).resolves.toBeNull();
    vi.useRealTimers();
  });

  it("aucun candidat si flashSuggestedAt est déjà non-null (déjà suggérée)", async () => {
    const invoices = [
      {
        id: "inv-1",
        organizationId: "org-a",
        number: "FG-2026-000005",
        amountDue: 500_000n,
        documentType: "invoice",
        status: "issued",
        issuedAt: WITHIN_30_MIN,
        flashSuggestedAt: new Date("2026-09-16T09:50:00.000Z"),
        customer: { phone: PHONE },
      },
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdFlashSuggestionService(prisma as any);
    vi.setSystemTime(NOW);

    await expect(service.findCandidate(PHONE)).resolves.toBeNull();
    vi.useRealTimers();
  });
});

describe("UssdFlashSuggestionService — markSuggested (best-effort, idempotent)", () => {
  it("marque la facture comme suggérée (scopée à l'organisation)", async () => {
    const invoices = [
      {
        id: "inv-1",
        organizationId: "org-a",
        flashSuggestedAt: null,
      },
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdFlashSuggestionService(prisma as any);

    await service.markSuggested("inv-1", "org-a");

    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: "inv-1", organizationId: "org-a", flashSuggestedAt: null },
      data: { flashSuggestedAt: expect.any(Date) },
    });
    expect(invoices[0].flashSuggestedAt).not.toBeNull();
  });

  it("idempotent — un second appel est sans effet (updateMany conditionnel, count 0)", async () => {
    const invoices = [
      {
        id: "inv-1",
        organizationId: "org-a",
        flashSuggestedAt: null,
      },
    ];
    const prisma = createRealisticPrisma(invoices);
    const service = new UssdFlashSuggestionService(prisma as any);

    await service.markSuggested("inv-1", "org-a");
    const firstMarkedAt = invoices[0].flashSuggestedAt;
    await service.markSuggested("inv-1", "org-a");

    expect(invoices[0].flashSuggestedAt).toBe(firstMarkedAt);
    expect(prisma.invoice.updateMany).toHaveBeenCalledTimes(2);
  });

  it("best-effort — une erreur Prisma ne remonte jamais (loguée, jamais bloquante)", async () => {
    const prisma = auClientScope({
      invoice: {
        updateMany: vi.fn().mockRejectedValue(new Error("DB indisponible")),
      },
    });
    const service = new UssdFlashSuggestionService(prisma as any);

    await expect(service.markSuggested("inv-1", "org-a")).resolves.toBeUndefined();
  });
});
