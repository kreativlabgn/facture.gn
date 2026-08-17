import { describe, expect, it, vi } from "vitest";
import { PublicBuyerAccountsService } from "./public-buyer-accounts.service";

function createFakePrisma(overrides: { publicBuyerAccount?: any; publicBuyerAccountMember?: any } = {}) {
  const tx = {
    publicBuyerAccount: {
      create: vi.fn().mockResolvedValue({ id: "pba-1", name: "Ministère des Finances" }),
    },
    publicBuyerAccountMember: {
      create: vi.fn().mockResolvedValue({ id: "pbam-1", publicBuyerAccountId: "pba-1", userId: "user-1" }),
    },
  };
  return {
    publicBuyerAccount: {
      findMany: vi.fn().mockResolvedValue([{ id: "pba-1", name: "Ministère des Finances" }]),
      ...overrides.publicBuyerAccount,
    },
    $transaction: vi.fn().mockImplementation((fn: any) => fn(tx)),
    __tx: tx,
  };
}

describe("PublicBuyerAccountsService — création self-service (ADR-098, même précédent que ProfessionalPractice)", () => {
  it("crée le compte et ajoute le créateur comme public_buyer_validator", async () => {
    const prisma = createFakePrisma();
    const service = new PublicBuyerAccountsService(prisma as any);

    const result = await service.create({ name: "Ministère des Finances" }, "user-1");

    expect(prisma.__tx.publicBuyerAccount.create).toHaveBeenCalledWith({
      data: { name: "Ministère des Finances" },
    });
    expect(prisma.__tx.publicBuyerAccountMember.create).toHaveBeenCalledWith({
      data: { publicBuyerAccountId: "pba-1", userId: "user-1", role: "public_buyer_validator" },
    });
    expect(result.id).toBe("pba-1");
  });
});

describe("PublicBuyerAccountsService — liste des comptes actifs (F16, sélecteur PME)", () => {
  it("liste tous les comptes acheteurs publics existants", async () => {
    const prisma = createFakePrisma();
    const service = new PublicBuyerAccountsService(prisma as any);

    const result = await service.listActive();

    expect(prisma.publicBuyerAccount.findMany).toHaveBeenCalledWith({ orderBy: { name: "asc" } });
    expect(result).toEqual([{ id: "pba-1", name: "Ministère des Finances" }]);
  });
});
