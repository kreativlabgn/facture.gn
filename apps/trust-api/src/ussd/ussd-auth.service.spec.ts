import { describe, expect, it, vi } from "vitest";
import { UssdAuthService } from "./ussd-auth.service";

const USER_ID = "user-1";
const PHONE = "+224622334455";
const ACCOUNT_CODE = "A8K2P9Q1";

function createFakePasswordService(overrides: { verifyResult?: boolean } = {}) {
  return {
    hash: vi.fn().mockResolvedValue("$argon2id$hashed-pin"),
    verify: vi.fn().mockResolvedValue(overrides.verifyResult ?? true),
    generateTemporaryPassword: vi.fn(),
  };
}

function createFakePrisma(overrides: { userPhone?: any; organization?: any; member?: any; user?: any } = {}) {
  return {
    userPhone: {
      findUnique: vi.fn().mockResolvedValue(overrides.userPhone ?? null),
      update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue(overrides.organization ?? null),
    },
    organizationMember: {
      findFirst: vi.fn().mockResolvedValue(overrides.member ?? null),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(overrides.user ?? null),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: USER_ID, ...data })),
    },
  };
}

describe("UssdAuthService — résolution (§3.1/3.2 Spec USSD)", () => {
  it("résout un téléphone reconnu via UserPhone, avec hasPin", async () => {
    const prisma = createFakePrisma({
      userPhone: { userId: USER_ID, msisdn: PHONE },
      user: { id: USER_ID, pinHash: "$argon2id$hashed-pin" },
    });
    const service = new UssdAuthService(prisma as any, createFakePasswordService() as any);

    const result = await service.resolveByPhone(PHONE);

    expect(result).toEqual({ userId: USER_ID, hasPin: true });
    expect(prisma.userPhone.findUnique).toHaveBeenCalledWith({ where: { msisdn: PHONE } });
  });

  it("résout un téléphone reconnu sans PIN encore défini — hasPin false (bootstrap à venir)", async () => {
    const prisma = createFakePrisma({ userPhone: { userId: USER_ID, msisdn: PHONE }, user: { id: USER_ID, pinHash: null } });
    const service = new UssdAuthService(prisma as any, createFakePasswordService() as any);

    const result = await service.resolveByPhone(PHONE);

    expect(result).toEqual({ userId: USER_ID, hasPin: false });
  });

  it("retourne null pour un téléphone inconnu", async () => {
    const prisma = createFakePrisma({ userPhone: null });
    const service = new UssdAuthService(prisma as any, createFakePasswordService() as any);

    await expect(service.resolveByPhone(PHONE)).resolves.toBeNull();
  });

  it("résout un code compte vers le owner de l'organisation, avec hasPin", async () => {
    const prisma = createFakePrisma({
      organization: { id: "org-1", accountCode: ACCOUNT_CODE },
      member: { userId: USER_ID, role: "owner" },
      user: { id: USER_ID, pinHash: "$argon2id$hashed-pin" },
    });
    const service = new UssdAuthService(prisma as any, createFakePasswordService() as any);

    const result = await service.resolveByAccountCode(ACCOUNT_CODE);

    expect(result).toEqual({ userId: USER_ID, organizationId: "org-1", hasPin: true });
    expect(prisma.organizationMember.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", role: "owner", revokedAt: null },
    });
  });

  it("retourne null pour un code compte inconnu", async () => {
    const prisma = createFakePrisma({ organization: null });
    const service = new UssdAuthService(prisma as any, createFakePasswordService() as any);

    await expect(service.resolveByAccountCode(ACCOUNT_CODE)).resolves.toBeNull();
  });

  it("retourne null si l'organisation n'a aucun owner actif", async () => {
    const prisma = createFakePrisma({ organization: { id: "org-1", accountCode: ACCOUNT_CODE }, member: null });
    const service = new UssdAuthService(prisma as any, createFakePasswordService() as any);

    await expect(service.resolveByAccountCode(ACCOUNT_CODE)).resolves.toBeNull();
  });
});

describe("UssdAuthService — création du PIN (bootstrap, décision utilisateur)", () => {
  it("hash le PIN et réinitialise le compteur d'essais", async () => {
    const prisma = createFakePrisma();
    const passwordService = createFakePasswordService();
    const service = new UssdAuthService(prisma as any, passwordService as any);

    await service.createPin(USER_ID, "1234");

    expect(passwordService.hash).toHaveBeenCalledWith("1234");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { pinHash: "$argon2id$hashed-pin", pinFailedAttempts: 0, pinLockedUntil: null },
    });
  });
});

describe("UssdAuthService — vérification du PIN et blocage (§3.3)", () => {
  it("accepte un PIN correct et réinitialise le compteur d'essais", async () => {
    const prisma = createFakePrisma({
      user: { id: USER_ID, pinHash: "$argon2id$hashed-pin", pinFailedAttempts: 1, pinLockedUntil: null },
    });
    const passwordService = createFakePasswordService({ verifyResult: true });
    const service = new UssdAuthService(prisma as any, passwordService as any);

    const result = await service.verifyPin(USER_ID, "1234");

    expect(result).toEqual({ success: true, locked: false });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { pinFailedAttempts: 0 },
    });
  });

  it("incrémente le compteur d'essais sur un PIN incorrect, sans bloquer avant le 3e échec", async () => {
    const prisma = createFakePrisma({
      user: { id: USER_ID, pinHash: "$argon2id$hashed-pin", pinFailedAttempts: 1, pinLockedUntil: null },
    });
    const passwordService = createFakePasswordService({ verifyResult: false });
    const service = new UssdAuthService(prisma as any, passwordService as any);

    const result = await service.verifyPin(USER_ID, "0000");

    expect(result).toEqual({ success: false, locked: false });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { pinFailedAttempts: 2, pinLockedUntil: null },
    });
  });

  it("bloque 30 minutes au 3e échec consécutif", async () => {
    const prisma = createFakePrisma({
      user: { id: USER_ID, pinHash: "$argon2id$hashed-pin", pinFailedAttempts: 2, pinLockedUntil: null },
    });
    const passwordService = createFakePasswordService({ verifyResult: false });
    const service = new UssdAuthService(prisma as any, passwordService as any);
    const before = Date.now();

    await service.verifyPin(USER_ID, "0000");

    const call = prisma.user.update.mock.calls[0][0];
    expect(call.data.pinFailedAttempts).toBe(3);
    const lockedUntil = call.data.pinLockedUntil.getTime();
    expect(lockedUntil).toBeGreaterThanOrEqual(before + 29.9 * 60_000);
    expect(lockedUntil).toBeLessThanOrEqual(before + 30.1 * 60_000);
  });

  it("refuse même un PIN correct si déjà bloqué — ne revérifie jamais le hash", async () => {
    const prisma = createFakePrisma({
      user: {
        id: USER_ID,
        pinHash: "$argon2id$hashed-pin",
        pinFailedAttempts: 3,
        pinLockedUntil: new Date(Date.now() + 10 * 60_000),
      },
    });
    const passwordService = createFakePasswordService({ verifyResult: true });
    const service = new UssdAuthService(prisma as any, passwordService as any);

    const result = await service.verifyPin(USER_ID, "1234");

    expect(result).toEqual({ success: false, locked: true });
    expect(passwordService.verify).not.toHaveBeenCalled();
  });

  it("laisse à nouveau tenter une fois le blocage expiré", async () => {
    const prisma = createFakePrisma({
      user: {
        id: USER_ID,
        pinHash: "$argon2id$hashed-pin",
        pinFailedAttempts: 3,
        pinLockedUntil: new Date(Date.now() - 60_000),
      },
    });
    const passwordService = createFakePasswordService({ verifyResult: true });
    const service = new UssdAuthService(prisma as any, passwordService as any);

    const result = await service.verifyPin(USER_ID, "1234");

    expect(result).toEqual({ success: true, locked: false });
  });
});

describe("UssdAuthService.confirmPhoneOwnership (F13, revue post-fix #2)", () => {
  it("marque le UserPhone vérifié quand il ne l'était pas encore", async () => {
    const prisma = createFakePrisma({ userPhone: { id: "phone-1", userId: USER_ID, msisdn: PHONE, verifiedAt: null } });
    const service = new UssdAuthService(prisma as any, createFakePasswordService() as any);

    await service.confirmPhoneOwnership(PHONE);

    expect(prisma.userPhone.update).toHaveBeenCalledWith({
      where: { id: "phone-1" },
      data: { verifiedAt: expect.any(Date) },
    });
  });

  it("idempotent — ne réécrit rien si déjà vérifié", async () => {
    const prisma = createFakePrisma({
      userPhone: { id: "phone-1", userId: USER_ID, msisdn: PHONE, verifiedAt: new Date("2026-01-01") },
    });
    const service = new UssdAuthService(prisma as any, createFakePasswordService() as any);

    await service.confirmPhoneOwnership(PHONE);

    expect(prisma.userPhone.update).not.toHaveBeenCalled();
  });

  it("numéro inconnu du repo — no-op silencieux, jamais une erreur", async () => {
    const prisma = createFakePrisma({ userPhone: null });
    const service = new UssdAuthService(prisma as any, createFakePasswordService() as any);

    await expect(service.confirmPhoneOwnership(PHONE)).resolves.toBeUndefined();
    expect(prisma.userPhone.update).not.toHaveBeenCalled();
  });
});
