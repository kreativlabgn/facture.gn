import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CreditNotesService } from "./credit-notes.service";

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

  const prisma: any = {
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
  };
  return prisma;
}

describe("CreditNotesService.create (C7, ADR-040)", () => {
  it("calcule amount côté serveur (quantityReturned × unitPrice), jamais une valeur du client", async () => {
    const prisma = createFakePrisma();
    const service = new CreditNotesService(prisma as any);

    const result = await service.create("inv-1", {
      reason: "Retour marchandise défectueuse",
      refundMultiplier: 1,
      lines: [{ invoiceLineId: "line-1", quantityReturned: 2 }],
    });

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
      service.create("inv-1", { reason: "Erreur", refundMultiplier: 1, lines: [{ invoiceLineId: "line-1", quantityReturned: 1 }] }),
    ).rejects.toThrow(ConflictException);
  });

  it("refuse un avoir sur un document qui n'est pas une facture (proforma/devis)", async () => {
    const prisma = createFakePrisma({ documentType: "proforma" });
    const service = new CreditNotesService(prisma as any);

    await expect(
      service.create("inv-1", { reason: "Erreur", refundMultiplier: 1, lines: [{ invoiceLineId: "line-1", quantityReturned: 1 }] }),
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
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("refuse une quantityReturned supérieure à la quantité originale de la ligne", async () => {
    const prisma = createFakePrisma();
    const service = new CreditNotesService(prisma as any);

    await expect(
      service.create("inv-1", { reason: "Erreur", refundMultiplier: 1, lines: [{ invoiceLineId: "line-1", quantityReturned: 6 }] }),
    ).rejects.toThrow(ConflictException);
  });

  it("refuse une quantityReturned qui dépasserait le solde encore créditable après un avoir précédent", async () => {
    // line-1 a une quantité de 5, dont 4 déjà créditées par un avoir antérieur —
    // il ne reste que 1 unité créditable.
    const prisma = createFakePrisma({}, 4);
    const service = new CreditNotesService(prisma as any);

    await expect(
      service.create("inv-1", { reason: "Erreur", refundMultiplier: 1, lines: [{ invoiceLineId: "line-1", quantityReturned: 2 }] }),
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
    });

    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("accepte refundMultiplier explicitement à 2 (arrhes + annulation professionnelle, ADR-034)", async () => {
    const prisma = createFakePrisma();
    const service = new CreditNotesService(prisma as any);

    const result = await service.create("inv-1", {
      reason: "Annulation professionnelle",
      refundMultiplier: 2,
      lines: [{ invoiceLineId: "line-1", quantityReturned: 1 }],
    });

    expect(result.refundMultiplier).toBe(2);
  });
});
