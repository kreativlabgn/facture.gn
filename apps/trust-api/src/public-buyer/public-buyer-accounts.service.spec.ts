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
    publicBuyerAccountMember: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.publicBuyerAccountMember,
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

  it("refuse la création si l'utilisateur est déjà membre d'un autre public_buyer_account (un DAF n'appartient qu'à un seul compte en V1)", async () => {
    const prisma = createFakePrisma({
      publicBuyerAccountMember: { findFirst: vi.fn().mockResolvedValue({ id: "pbam-existing", publicBuyerAccountId: "pba-0", userId: "user-1" }) },
    });
    const service = new PublicBuyerAccountsService(prisma as any);

    await expect(service.create({ name: "Ministère de la Santé" }, "user-1")).rejects.toThrow(/déjà membre/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("PublicBuyerAccountsService — liste des comptes actifs (F16, sélecteur PME)", () => {
  it("liste tous les comptes acheteurs publics existants, avec un select restreint à {id, name} (Security Audit 2026-08-23, revue post-fix #1) — jamais verificationStatus, exposé sans @Roles() à tout utilisateur authentifié", async () => {
    const prisma = createFakePrisma();
    const service = new PublicBuyerAccountsService(prisma as any);

    const result = await service.listActive();

    expect(prisma.publicBuyerAccount.findMany).toHaveBeenCalledWith({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    expect(result).toEqual([{ id: "pba-1", name: "Ministère des Finances" }]);
  });
});
