import { describe, expect, it, vi } from "vitest";
import { UssdSessionService } from "./ussd-session.service";

const SESSION_ID = "ATUid_abc123";
const PHONE = "+224622334455";
const USER_ID = "user-1";
const ORG_ID = "org-1";

function createFakePrisma(overrides: { existingSession?: any } = {}) {
  return {
    ussdSession: {
      findUnique: vi.fn().mockResolvedValue(overrides.existingSession ?? null),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "session-row-1", ...data })),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "session-row-1", ...data })),
    },
  };
}

function createFakeUssdAuth(overrides: {
  resolveByPhone?: ReturnType<typeof vi.fn>;
  resolveByAccountCode?: ReturnType<typeof vi.fn>;
  verifyPin?: ReturnType<typeof vi.fn>;
  createPin?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    resolveByPhone: overrides.resolveByPhone ?? vi.fn().mockResolvedValue(null),
    resolveByAccountCode: overrides.resolveByAccountCode ?? vi.fn().mockResolvedValue(null),
    verifyPin: overrides.verifyPin ?? vi.fn().mockResolvedValue({ success: true, locked: false }),
    createPin: overrides.createPin ?? vi.fn().mockResolvedValue(undefined),
  };
}

function existingSession(overrides: { state?: string; contextData?: any; expiresInMs?: number } = {}) {
  return {
    id: "session-row-1",
    sessionId: SESSION_ID,
    phone: PHONE,
    state: overrides.state ?? "root",
    contextData: overrides.contextData ?? null,
    expiresAt: new Date(Date.now() + (overrides.expiresInMs ?? 60_000)),
  };
}

describe("UssdSessionService — menu racine (§1 Spec USSD)", () => {
  it("crée une session neuve à l'état root et affiche le menu canonique quand sessionId est inconnu", async () => {
    const prisma = createFakePrisma();
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "");

    expect(prisma.ussdSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sessionId: SESSION_ID, phone: PHONE, state: "root" }) }),
    );
    expect(result.continue).toBe(true);
    expect(result.text).toContain("Payer une facture");
    expect(result.text).toContain("Émettre une facture");
  });

  it("recharge une session existante par sessionId au lieu d'en recréer une", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession() });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any);

    await service.handleRequest(SESSION_ID, PHONE, "");

    expect(prisma.ussdSession.create).not.toHaveBeenCalled();
  });

  it("recrée une session neuve si la précédente a expiré, jamais une erreur", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession({ expiresInMs: -60_000 }) });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "");

    expect(prisma.ussdSession.create).toHaveBeenCalled();
    expect(result.continue).toBe(true);
  });

  it("répond 'bientôt disponible' pour l'option 2 (vérifier un reçu, non authentifiée) — branche à venir", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession() });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "2");

    expect(result.continue).toBe(false);
    expect(result.text).toContain("bientôt disponible");
  });
});

describe("UssdSessionService — sous-flux d'authentification (D2, §3 Spec USSD)", () => {
  it("téléphone reconnu avec PIN déjà défini → demande le PIN directement", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession() });
    const ussdAuth = createFakeUssdAuth({
      resolveByPhone: vi.fn().mockResolvedValue({ userId: USER_ID, hasPin: true }),
    });
    const service = new UssdSessionService(prisma as any, ussdAuth as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "4");

    expect(result).toEqual({ continue: true, text: "Entrez votre PIN :" });
    expect(prisma.ussdSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "auth_pin" }) }),
    );
  });

  it("PIN correct → authentifie et répond pour l'option demandée", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_pin", contextData: { pendingOption: "4", authUserId: USER_ID } }),
    });
    const ussdAuth = createFakeUssdAuth({ verifyPin: vi.fn().mockResolvedValue({ success: true, locked: false }) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(ussdAuth.verifyPin).toHaveBeenCalledWith(USER_ID, "1234");
    expect(result.text).toContain("Option 4");
    expect(prisma.ussdSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "authenticated_stub", userId: USER_ID }) }),
    );
  });

  it("PIN incorrect (pas encore bloqué) → reste dans l'état d'attente du PIN", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_pin", contextData: { pendingOption: "4", authUserId: USER_ID } }),
    });
    const ussdAuth = createFakeUssdAuth({ verifyPin: vi.fn().mockResolvedValue({ success: false, locked: false }) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "0000");

    expect(result).toEqual({ continue: true, text: "PIN incorrect. Réessayez :" });
  });

  it("PIN bloqué (3e échec déjà atteint) → termine la session sans revérifier", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_pin", contextData: { pendingOption: "4", authUserId: USER_ID } }),
    });
    const ussdAuth = createFakeUssdAuth({ verifyPin: vi.fn().mockResolvedValue({ success: false, locked: true }) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(result.continue).toBe(false);
    expect(result.text).toContain("bloqué");
  });

  it("téléphone non reconnu → demande le code compte", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession() });
    const ussdAuth = createFakeUssdAuth({ resolveByPhone: vi.fn().mockResolvedValue(null) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "4");

    expect(result).toEqual({ continue: true, text: "Numéro non reconnu. Entrez votre code compte :" });
  });

  it("code compte invalide → termine la session", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_account_code", contextData: { pendingOption: "4" } }),
    });
    const ussdAuth = createFakeUssdAuth({ resolveByAccountCode: vi.fn().mockResolvedValue(null) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "BADCODE1");

    expect(result).toEqual({ continue: false, text: "Code compte invalide." });
  });

  it("code compte valide → demande le PIN, organisation retenue dans le contexte", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_account_code", contextData: { pendingOption: "4" } }),
    });
    const ussdAuth = createFakeUssdAuth({
      resolveByAccountCode: vi.fn().mockResolvedValue({ userId: USER_ID, organizationId: ORG_ID, hasPin: true }),
    });
    const service = new UssdSessionService(prisma as any, ussdAuth as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "A8K2P9Q1");

    expect(result).toEqual({ continue: true, text: "Entrez votre PIN :" });
    expect(prisma.ussdSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "auth_account_pin", contextData: expect.objectContaining({ authOrganizationId: ORG_ID }) }),
      }),
    );
  });

  it("aucun PIN encore défini → propose la création (décision utilisateur, bootstrap *620#)", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession() });
    const ussdAuth = createFakeUssdAuth({
      resolveByPhone: vi.fn().mockResolvedValue({ userId: USER_ID, hasPin: false }),
    });
    const service = new UssdSessionService(prisma as any, ussdAuth as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "4");

    expect(result.text).toContain("Créez un PIN");
    expect(prisma.ussdSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "auth_new_pin" }) }),
    );
  });

  it("création du PIN — format invalide reprompt sans avancer d'état", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_new_pin", contextData: { pendingOption: "4", authUserId: USER_ID } }),
    });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "12a4");

    expect(result.continue).toBe(true);
    expect(result.text).toContain("invalide");
  });

  it("création du PIN — demande confirmation après une saisie au bon format", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_new_pin", contextData: { pendingOption: "4", authUserId: USER_ID } }),
    });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(result).toEqual({ continue: true, text: "Confirmez votre PIN :" });
    expect(prisma.ussdSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "auth_new_pin_confirm", contextData: expect.objectContaining({ pendingPin: "1234" }) }),
      }),
    );
  });

  it("confirmation qui ne correspond pas → termine la session, jamais un PIN créé", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({
        state: "auth_new_pin_confirm",
        contextData: { pendingOption: "4", authUserId: USER_ID, pendingPin: "1234" },
      }),
    });
    const ussdAuth = createFakeUssdAuth();
    const service = new UssdSessionService(prisma as any, ussdAuth as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "5678");

    expect(result.continue).toBe(false);
    expect(ussdAuth.createPin).not.toHaveBeenCalled();
  });

  it("confirmation qui correspond → crée le PIN et authentifie", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({
        state: "auth_new_pin_confirm",
        contextData: { pendingOption: "4", authUserId: USER_ID, pendingPin: "1234" },
      }),
    });
    const ussdAuth = createFakeUssdAuth();
    const service = new UssdSessionService(prisma as any, ussdAuth as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(ussdAuth.createPin).toHaveBeenCalledWith(USER_ID, "1234");
    expect(result.text).toContain("Option 4");
  });
});
