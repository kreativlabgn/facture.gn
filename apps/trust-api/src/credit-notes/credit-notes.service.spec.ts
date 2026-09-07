import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CreditNotesService } from "./credit-notes.service";

// organizationScopedClient() appelle `$extends`, et setOrganizationScope() pose le
// GUC via `$executeRaw`. Le vrai client offre les deux ; un faux qui ne les offre
// pas ne teste pas le service migré, il plante dessus. `$extends` rend le client
// LUI-MÊME pour que les mocks restent partagés. `$transaction` bi-forme : la forme
// tableau est celle qu'emploie makeScopedOperation(), ce qui rend l'extension
// rejouable — indispensable pour épingler la VALEUR du client scopé.
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

function createFakePrisma(invoiceOverrides: Record<string, unknown> = {}, alreadyCreditedSum = 0) {
  const invoice = {
    id: "inv-1",
    documentType: "invoice",
    status: "issued",
    lines: [
      { id: "line-1", quantity: 5, unitPrice: 100_000n },
      { id: "line-2", quantity: 2, unitPrice: 50_000n },
    ],
    ...invoiceOverrides,
  };

  const prisma: any = auClientScope({
    invoice: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(invoice),
    },
    creditNoteLine: {
      groupBy: vi.fn().mockResolvedValue(
        alreadyCreditedSum > 0 ? [{ invoiceLineId: "line-1", _sum: { quantityReturned: alreadyCreditedSum } }] : [],
      ),
    },
    creditNote: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "cn-1", ...data })),
    },
  });
  return prisma;
}

describe("CreditNotesService.create (C7, ADR-040)", () => {
  // Ce module n'ouvre aucune transaction : tout son scope passe par
  // organizationScopedClient(), dont la valeur n'est observable qu'en rejouant
  // l'extension capturée (les faux `$extends` se renvoient eux-mêmes).
  it("pose app.current_org_id sur l'organisation du RolesGuard, jamais une autre", async () => {
    const prisma = createFakePrisma();
    const service = new CreditNotesService(prisma as any);

    await service.create(
      "inv-1",
      { reason: "Retour", refundMultiplier: 1, lines: [{ invoiceLineId: "line-1", quantityReturned: 1 }] },
      "org-a-proteger",
    );

    const extension = (prisma as any).$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });

    const setConfig = (prisma as any).$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-a-proteger");
  });


  it("calcule amount côté serveur (quantityReturned × unitPrice), jamais une valeur du client", async () => {
    const prisma = createFakePrisma();
    const service = new CreditNotesService(prisma as any);

    const result = await service.create("inv-1", {
      reason: "Retour marchandise défectueuse",
      refundMultiplier: 1,
      lines: [{ invoiceLineId: "line-1", quantityReturned: 2 }],
    }, "org-1");

    expect(result.amount).toBe(200_000n);
    expect(prisma.creditNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 200_000n, invoiceId: "inv-1", reason: "Retour marchandise défectueuse" }),
      }),
    );
  });

  it("refuse un avoir sur une facture draft — rien n'a encore été émis", async () => {
    const prisma = createFakePrisma({ status: "draft" });
    const service = new CreditNotesService(prisma as any);

    await expect(
      service.create("inv-1", { reason: "Erreur", refundMultiplier: 1, lines: [{ invoiceLineId: "line-1", quantityReturned: 1 }] }, "org-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("refuse un avoir sur un document qui n'est pas une facture (proforma/devis)", async () => {
    const prisma = createFakePrisma({ documentType: "proforma" });
    const service = new CreditNotesService(prisma as any);

    await expect(
      service.create("inv-1", { reason: "Erreur", refundMultiplier: 1, lines: [{ invoiceLineId: "line-1", quantityReturned: 1 }] }, "org-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("refuse une ligne qui n'appartient pas à la facture ciblée", async () => {
    const prisma = createFakePrisma();
    const service = new CreditNotesService(prisma as any);

    await expect(
      service.create("inv-1", {
        reason: "Erreur",
        refundMultiplier: 1,
        lines: [{ invoiceLineId: "line-etrangere", quantityReturned: 1 }],
      }, "org-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("refuse une quantityReturned supérieure à la quantité originale de la ligne", async () => {
    const prisma = createFakePrisma();
    const service = new CreditNotesService(prisma as any);

    await expect(
      service.create("inv-1", { reason: "Erreur", refundMultiplier: 1, lines: [{ invoiceLineId: "line-1", quantityReturned: 6 }] }, "org-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("refuse une quantityReturned qui dépasserait le solde encore créditable après un avoir précédent", async () => {
    // line-1 a une quantité de 5, dont 4 déjà créditées par un avoir antérieur —
    // il ne reste que 1 unité créditable.
    const prisma = createFakePrisma({}, 4);
    const service = new CreditNotesService(prisma as any);

    await expect(
      service.create("inv-1", { reason: "Erreur", refundMultiplier: 1, lines: [{ invoiceLineId: "line-1", quantityReturned: 2 }] }, "org-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("n'affecte jamais Invoice.totalTtc/amountDue/amountPaid — bucket financier séparé (précédent C5)", async () => {
    const prisma = createFakePrisma();
    prisma.invoice.update = vi.fn();
    const service = new CreditNotesService(prisma as any);

    await service.create("inv-1", {
      reason: "Retour",
      refundMultiplier: 1,
      lines: [{ invoiceLineId: "line-1", quantityReturned: 1 }],
    }, "org-1");

    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("accepte refundMultiplier explicitement à 2 (arrhes + annulation professionnelle, ADR-034)", async () => {
    const prisma = createFakePrisma();
    const service = new CreditNotesService(prisma as any);

    const result = await service.create("inv-1", {
      reason: "Annulation professionnelle",
      refundMultiplier: 2,
      lines: [{ invoiceLineId: "line-1", quantityReturned: 1 }],
    }, "org-1");

    expect(result.refundMultiplier).toBe(2);
  });
});
