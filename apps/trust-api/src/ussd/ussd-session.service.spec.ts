import { ForbiddenException, NotFoundException } from "@nestjs/common";
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

function createFakeVerification(overrides: { verifyByCertificationId?: ReturnType<typeof vi.fn> } = {}) {
  return {
    verifyByCertificationId: overrides.verifyByCertificationId ?? vi.fn().mockRejectedValue(new NotFoundException()),
  };
}

function createFakeUssdInvoice(overrides: {
  resolveOrganizationForEmission?: ReturnType<typeof vi.fn>;
  resolveOrCreateCustomer?: ReturnType<typeof vi.fn>;
  emitInvoice?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    resolveOrganizationForEmission: overrides.resolveOrganizationForEmission ?? vi.fn().mockResolvedValue(ORG_ID),
    resolveOrCreateCustomer: overrides.resolveOrCreateCustomer ?? vi.fn().mockResolvedValue(undefined),
    emitInvoice: overrides.emitInvoice ?? vi.fn().mockResolvedValue({ id: "inv-1", number: "FG-2026-000001" }),
  };
}

function createFakeUssdPayment(overrides: {
  findPayableInvoice?: ReturnType<typeof vi.fn>;
  previewFee?: ReturnType<typeof vi.fn>;
  confirmPayment?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    findPayableInvoice: overrides.findPayableInvoice ?? vi.fn().mockResolvedValue(null),
    previewFee: overrides.previewFee ?? vi.fn().mockResolvedValue(0n),
    confirmPayment: overrides.confirmPayment ?? vi.fn().mockResolvedValue({ id: "inv-1" }),
  };
}

function createFakeUssdInvoiceList(overrides: { listRecent?: ReturnType<typeof vi.fn> } = {}) {
  return { listRecent: overrides.listRecent ?? vi.fn().mockResolvedValue([]) };
}

function createFakeUssdAccount(overrides: {
  changePin?: ReturnType<typeof vi.fn>;
  getTierSummary?: ReturnType<typeof vi.fn>;
  listPendingMandates?: ReturnType<typeof vi.fn>;
  listActiveMandates?: ReturnType<typeof vi.fn>;
  acceptMandate?: ReturnType<typeof vi.fn>;
  revokeMandate?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    changePin: overrides.changePin ?? vi.fn().mockResolvedValue(undefined),
    getTierSummary: overrides.getTierSummary ?? vi.fn().mockResolvedValue("T1"),
    listPendingMandates: overrides.listPendingMandates ?? vi.fn().mockResolvedValue([]),
    listActiveMandates: overrides.listActiveMandates ?? vi.fn().mockResolvedValue([]),
    acceptMandate: overrides.acceptMandate ?? vi.fn().mockResolvedValue(undefined),
    revokeMandate: overrides.revokeMandate ?? vi.fn().mockResolvedValue(undefined),
  };
}

function existingSession(
  overrides: { state?: string; contextData?: any; expiresInMs?: number; userId?: string; organizationId?: string } = {},
) {
  return {
    id: "session-row-1",
    sessionId: SESSION_ID,
    phone: PHONE,
    state: overrides.state ?? "root",
    contextData: overrides.contextData ?? null,
    userId: overrides.userId ?? null,
    organizationId: overrides.organizationId ?? null,
    expiresAt: new Date(Date.now() + (overrides.expiresInMs ?? 60_000)),
  };
}

describe("UssdSessionService — menu racine (§1 Spec USSD)", () => {
  it("crée une session neuve à l'état root et affiche le menu canonique quand sessionId est inconnu", async () => {
    const prisma = createFakePrisma();
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

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
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    await service.handleRequest(SESSION_ID, PHONE, "");

    expect(prisma.ussdSession.create).not.toHaveBeenCalled();
  });

  it("recrée une session neuve si la précédente a expiré, jamais une erreur", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession({ expiresInMs: -60_000 }) });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "");

    expect(prisma.ussdSession.create).toHaveBeenCalled();
    expect(result.continue).toBe(true);
  });

});

describe("UssdSessionService — option 2, vérifier un reçu (§2.2 Spec USSD, sans authentification)", () => {
  it("demande l'identifiant de vérification, aucune authentification déclenchée", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession() });
    const ussdAuth = createFakeUssdAuth();
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "2");

    expect(result).toEqual({ continue: true, text: "Entrez l'identifiant de vérification :" });
    expect(ussdAuth.resolveByPhone).not.toHaveBeenCalled();
  });

  it("identifiant valide → affiche numéro, montant et statut, sans ligne contestation si none", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession({ state: "verify_awaiting_code" }) });
    const verification = createFakeVerification({
      verifyByCertificationId: vi.fn().mockResolvedValue({
        certificationId: "GN-GN123456-2026-ABCDEF",
        number: "FG-2026-000001",
        organizationName: "Boutique Aissatou",
        organizationNif: "GN12345678",
        totalTtc: "150000000",
        issuedAt: "2026-08-01T00:00:00.000Z",
        status: "issued",
        disputeStatus: "none",
        validatedByAdministration: false,
        integrityValid: true,
      }),
    });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, verification as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "GN-GN123456-2026-ABCDEF");

    expect(verification.verifyByCertificationId).toHaveBeenCalledWith("GN-GN123456-2026-ABCDEF");
    expect(result.continue).toBe(false);
    expect(result.text).toContain("FG-2026-000001");
    expect(result.text).toContain("1 500 000 GNF");
    expect(result.text).not.toContain("Contestation");
  });

  it("affiche la ligne contestation quand disputeStatus ≠ none", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession({ state: "verify_awaiting_code" }) });
    const verification = createFakeVerification({
      verifyByCertificationId: vi.fn().mockResolvedValue({
        certificationId: "GN-GN123456-2026-ABCDEF",
        number: "FG-2026-000001",
        organizationName: "Boutique Aissatou",
        organizationNif: "GN12345678",
        totalTtc: "150000000",
        issuedAt: "2026-08-01T00:00:00.000Z",
        status: "issued",
        disputeStatus: "disputed",
        validatedByAdministration: false,
        integrityValid: true,
      }),
    });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, verification as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "GN-GN123456-2026-ABCDEF");

    expect(result.text).toContain("Contestation");
  });

  it("identifiant invalide → message d'échec, termine la session", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession({ state: "verify_awaiting_code" }) });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "INCONNU");

    expect(result).toEqual({ continue: false, text: "Aucune facture ne correspond à cet identifiant." });
  });
});

describe("UssdSessionService — sous-flux d'authentification (D2, §3 Spec USSD)", () => {
  it("téléphone reconnu avec PIN déjà défini → demande le PIN directement", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession() });
    const ussdAuth = createFakeUssdAuth({
      resolveByPhone: vi.fn().mockResolvedValue({ userId: USER_ID, hasPin: true }),
    });
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "4");

    expect(result).toEqual({ continue: true, text: "Entrez votre PIN :" });
    expect(prisma.ussdSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "auth_pin" }) }),
    );
  });

  it("PIN correct, option inconnue (garde-fou défensif) → authentifie et répond le stub générique", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_pin", contextData: { pendingOption: "9", authUserId: USER_ID } }),
    });
    const ussdAuth = createFakeUssdAuth({ verifyPin: vi.fn().mockResolvedValue({ success: true, locked: false }) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(ussdAuth.verifyPin).toHaveBeenCalledWith(USER_ID, "1234");
    expect(result.text).toContain("Option 9");
    expect(prisma.ussdSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "authenticated_stub", userId: USER_ID }) }),
    );
  });

  it("PIN correct, option 4 → authentifie et entre dans le flux d'émission", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_pin", contextData: { pendingOption: "4", authUserId: USER_ID } }),
    });
    const ussdAuth = createFakeUssdAuth({ verifyPin: vi.fn().mockResolvedValue({ success: true, locked: false }) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(result.text).toBe("Montant de la facture (GNF) :");
    expect(prisma.ussdSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "emit_awaiting_amount", userId: USER_ID }) }),
    );
  });

  it("PIN incorrect (pas encore bloqué) → reste dans l'état d'attente du PIN", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_pin", contextData: { pendingOption: "4", authUserId: USER_ID } }),
    });
    const ussdAuth = createFakeUssdAuth({ verifyPin: vi.fn().mockResolvedValue({ success: false, locked: false }) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "0000");

    expect(result).toEqual({ continue: true, text: "PIN incorrect. Réessayez :" });
  });

  it("PIN bloqué (3e échec déjà atteint) → termine la session sans revérifier", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_pin", contextData: { pendingOption: "4", authUserId: USER_ID } }),
    });
    const ussdAuth = createFakeUssdAuth({ verifyPin: vi.fn().mockResolvedValue({ success: false, locked: true }) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(result.continue).toBe(false);
    expect(result.text).toContain("bloqué");
  });

  it("téléphone non reconnu → demande le code compte", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession() });
    const ussdAuth = createFakeUssdAuth({ resolveByPhone: vi.fn().mockResolvedValue(null) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "4");

    expect(result).toEqual({ continue: true, text: "Numéro non reconnu. Entrez votre code compte :" });
  });

  it("code compte invalide → termine la session", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_account_code", contextData: { pendingOption: "4" } }),
    });
    const ussdAuth = createFakeUssdAuth({ resolveByAccountCode: vi.fn().mockResolvedValue(null) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

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
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

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
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

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
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "12a4");

    expect(result.continue).toBe(true);
    expect(result.text).toContain("invalide");
  });

  it("création du PIN — demande confirmation après une saisie au bon format", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_new_pin", contextData: { pendingOption: "4", authUserId: USER_ID } }),
    });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

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
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "5678");

    expect(result.continue).toBe(false);
    expect(ussdAuth.createPin).not.toHaveBeenCalled();
  });

  it("confirmation qui correspond, option 4 → crée le PIN et entre dans le flux d'émission", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({
        state: "auth_new_pin_confirm",
        contextData: { pendingOption: "4", authUserId: USER_ID, pendingPin: "1234" },
      }),
    });
    const ussdAuth = createFakeUssdAuth();
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(ussdAuth.createPin).toHaveBeenCalledWith(USER_ID, "1234");
    expect(result.text).toContain("Montant de la facture");
  });

  it("confirmation qui correspond, option inconnue (garde-fou défensif) → stub générique", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({
        state: "auth_new_pin_confirm",
        contextData: { pendingOption: "9", authUserId: USER_ID, pendingPin: "1234" },
      }),
    });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(result.text).toContain("Option 9 bientôt disponible");
  });
});

describe("UssdSessionService — option 4, émettre une facture (D1, §2.4 Spec USSD)", () => {
  it("authentification réussie sur l'option 4 → demande le montant", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_pin", contextData: { pendingOption: "4", authUserId: USER_ID } }),
    });
    const ussdAuth = createFakeUssdAuth({ verifyPin: vi.fn().mockResolvedValue({ success: true, locked: false }) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(result).toEqual({ continue: true, text: "Montant de la facture (GNF) :" });
    expect(prisma.ussdSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "emit_awaiting_amount", userId: USER_ID }) }),
    );
  });

  it("montant invalide → reprompt sans avancer d'état", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession({ state: "emit_awaiting_amount" }) });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "abc");

    expect(result).toEqual({ continue: true, text: "Montant invalide. Réessayez :" });
  });

  it("montant valide → demande le numéro du client", async () => {
    const prisma = createFakePrisma({ existingSession: existingSession({ state: "emit_awaiting_amount" }) });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "500000");

    expect(result).toEqual({ continue: true, text: "Numéro du client (laisser vide si aucun) :" });
    expect(prisma.ussdSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "emit_awaiting_customer_phone", contextData: { emitAmountCentimes: "50000000" } }),
      }),
    );
  });

  it("numéro invalide → reprompt sans avancer d'état", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "emit_awaiting_customer_phone", contextData: { emitAmountCentimes: "50000000" } }),
    });
    const ussdInvoice = createFakeUssdInvoice();
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, ussdInvoice as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "0620000000");

    expect(result).toEqual({ continue: true, text: "Numéro invalide. Réessayez :" });
    expect(ussdInvoice.emitInvoice).not.toHaveBeenCalled();
  });

  it("téléphone vide (aucun client) → émet sans customerId, aucune mention SMS", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({
        state: "emit_awaiting_customer_phone",
        contextData: { emitAmountCentimes: "50000000" },
        userId: USER_ID,
      }),
    });
    const ussdInvoice = createFakeUssdInvoice();
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, ussdInvoice as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "");

    expect(ussdInvoice.resolveOrganizationForEmission).toHaveBeenCalledWith(USER_ID, undefined);
    expect(ussdInvoice.resolveOrCreateCustomer).toHaveBeenCalledWith(ORG_ID, undefined);
    expect(ussdInvoice.emitInvoice).toHaveBeenCalledWith(ORG_ID, 50_000_000n, undefined);
    expect(result.text).toContain("FG-2026-000001");
    expect(result.text).not.toContain("SMS");
  });

  it("plafond de vélocité dépassé (D4) → message d'échec explicite, session terminée", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({
        state: "emit_awaiting_customer_phone",
        contextData: { emitAmountCentimes: "50000000" },
      }),
    });
    const ussdInvoice = createFakeUssdInvoice({
      emitInvoice: vi.fn().mockRejectedValue(new ForbiddenException("Plafond journalier dépassé (palier T0) : 1 500 000 GNF/jour")),
    });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, ussdInvoice as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "");

    expect(result).toEqual({ continue: false, text: "Plafond journalier dépassé (palier T0) : 1 500 000 GNF/jour" });
  });

  it("aucune organisation habilitée trouvée → message d'échec, aucune facture émise", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({
        state: "emit_awaiting_customer_phone",
        contextData: { emitAmountCentimes: "50000000" },
      }),
    });
    const ussdInvoice = createFakeUssdInvoice({ resolveOrganizationForEmission: vi.fn().mockResolvedValue(null) });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, ussdInvoice as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "");

    expect(result.continue).toBe(false);
    expect(ussdInvoice.emitInvoice).not.toHaveBeenCalled();
  });
});

describe("UssdSessionService — option 1, payer une facture (D3, §2.1 Spec USSD)", () => {
  it("authentification réussie sur l'option 1 → demande le numéro de facture", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_pin", contextData: { pendingOption: "1", authUserId: USER_ID } }),
    });
    const ussdAuth = createFakeUssdAuth({ verifyPin: vi.fn().mockResolvedValue({ success: true, locked: false }) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(result).toEqual({ continue: true, text: "Numéro de facture :" });
    expect(prisma.ussdSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "pay_awaiting_invoice_number", userId: USER_ID }) }),
    );
  });

  it("numéro inconnu → message d'échec, termine la session", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "pay_awaiting_invoice_number", userId: USER_ID }),
    });
    const ussdInvoice = createFakeUssdInvoice();
    const ussdPayment = createFakeUssdPayment({ findPayableInvoice: vi.fn().mockResolvedValue(null) });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, ussdInvoice as any, ussdPayment as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "FG-INCONNU");

    expect(result).toEqual({ continue: false, text: "Aucune facture payable ne correspond à ce numéro." });
  });

  it("numéro trouvé → affiche montant dû + frais + total, demande confirmation", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "pay_awaiting_invoice_number", userId: USER_ID }),
    });
    const ussdPayment = createFakeUssdPayment({
      findPayableInvoice: vi.fn().mockResolvedValue({ id: "inv-1", number: "FG-2026-000001", amountDue: 500_000n }),
      previewFee: vi.fn().mockResolvedValue(10_500n),
    });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, ussdPayment as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "FG-2026-000001");

    expect(result.continue).toBe(true);
    expect(result.text).toContain("5 000 GNF");
    expect(result.text).toContain("105 GNF");
    expect(result.text).toContain("5 105 GNF");
    expect(prisma.ussdSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "pay_awaiting_confirmation" }) }),
    );
  });

  it("confirmation ('1') → régénère le lien de paiement", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({
        state: "pay_awaiting_confirmation",
        contextData: { payInvoiceId: "inv-1", payInvoiceNumber: "FG-2026-000001" },
        userId: USER_ID,
      }),
    });
    const ussdPayment = createFakeUssdPayment({ confirmPayment: vi.fn().mockResolvedValue({ id: "inv-1" }) });
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, ussdPayment as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1");

    expect(ussdPayment.confirmPayment).toHaveBeenCalledWith("inv-1", USER_ID);
    expect(result).toEqual({ continue: false, text: "Lien de paiement envoyé pour la facture FG-2026-000001." });
  });

  it("annulation (tout autre input) → aucune régénération de lien", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({
        state: "pay_awaiting_confirmation",
        contextData: { payInvoiceId: "inv-1", payInvoiceNumber: "FG-2026-000001" },
      }),
    });
    const ussdPayment = createFakeUssdPayment();
    const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, ussdPayment as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "2");

    expect(result).toEqual({ continue: false, text: "Paiement annulé." });
    expect(ussdPayment.confirmPayment).not.toHaveBeenCalled();
  });
});

describe("UssdSessionService — option 3, mes factures (§2.3 Spec USSD)", () => {
  it("authentification réussie sur l'option 3 → affiche directement la liste, aucun sous-état supplémentaire", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_pin", contextData: { pendingOption: "3", authUserId: USER_ID } }),
    });
    const ussdAuth = createFakeUssdAuth({ verifyPin: vi.fn().mockResolvedValue({ success: true, locked: false }) });
    const ussdInvoiceList = createFakeUssdInvoiceList({
      listRecent: vi.fn().mockResolvedValue([
        { number: "FG-2026-000002", status: "issued", totalTtc: "300000000" },
        { number: "FG-2026-000001", status: "paid", totalTtc: "150000000" },
      ]),
    });
    const service = new UssdSessionService(
      prisma as any,
      ussdAuth as any,
      createFakeVerification() as any,
      createFakeUssdInvoice() as any,
      createFakeUssdPayment() as any,
      ussdInvoiceList as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(result.continue).toBe(false);
    expect(result.text).toContain("FG-2026-000002");
    expect(result.text).toContain("Non payée");
    expect(result.text).toContain("FG-2026-000001");
    expect(result.text).toContain("Payée");
  });

  it("liste vide → message explicite, jamais un écran vide", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_pin", contextData: { pendingOption: "3", authUserId: USER_ID } }),
    });
    const ussdAuth = createFakeUssdAuth({ verifyPin: vi.fn().mockResolvedValue({ success: true, locked: false }) });
    const service = new UssdSessionService(
      prisma as any,
      ussdAuth as any,
      createFakeVerification() as any,
      createFakeUssdInvoice() as any,
      createFakeUssdPayment() as any,
      createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(result).toEqual({ continue: false, text: "Aucune facture pour le moment." });
  });
});

describe("UssdSessionService — option 5, gérer mon compte (§2.5 Spec USSD)", () => {
  it("authentification réussie sur l'option 5 → affiche le sous-menu 5.1-5.4", async () => {
    const prisma = createFakePrisma({
      existingSession: existingSession({ state: "auth_pin", contextData: { pendingOption: "5", authUserId: USER_ID } }),
    });
    const ussdAuth = createFakeUssdAuth({ verifyPin: vi.fn().mockResolvedValue({ success: true, locked: false }) });
    const service = new UssdSessionService(prisma as any, ussdAuth as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1234");

    expect(result.continue).toBe(true);
    expect(result.text).toContain("Changer mon PIN");
    expect(result.text).toContain("Voir mon palier");
    expect(result.text).toContain("Mandats en attente");
    expect(result.text).toContain("Mandats actifs");
    expect(prisma.ussdSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "manage_account_menu", userId: USER_ID }) }),
    );
  });

  describe("5.1 — changer mon PIN (chiffres uniquement, aucune lettre)", () => {
    it("choix 1 → demande le nouveau PIN", async () => {
      const prisma = createFakePrisma({ existingSession: existingSession({ state: "manage_account_menu" }) });
      const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

      const result = await service.handleRequest(SESSION_ID, PHONE, "1");

      expect(result).toEqual({ continue: true, text: "Nouveau PIN (4 chiffres) :" });
      expect(prisma.ussdSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: "account_new_pin" }) }),
      );
    });

    it("format invalide → reprompt", async () => {
      const prisma = createFakePrisma({ existingSession: existingSession({ state: "account_new_pin" }) });
      const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

      const result = await service.handleRequest(SESSION_ID, PHONE, "12a4");

      expect(result.continue).toBe(true);
      expect(result.text).toContain("invalide");
    });

    it("resaisie du même PIN (confirmation par chiffres) → change le PIN via UssdAccountService", async () => {
      const prisma = createFakePrisma({
        existingSession: existingSession({
          state: "account_new_pin_confirm",
          contextData: { pendingPin: "5678" },
          userId: USER_ID,
          organizationId: ORG_ID,
        }),
      });
      const ussdAccount = createFakeUssdAccount();
      const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, ussdAccount as any);

      const result = await service.handleRequest(SESSION_ID, PHONE, "5678");

      expect(ussdAccount.changePin).toHaveBeenCalledWith(USER_ID, ORG_ID, "5678");
      expect(result.continue).toBe(false);
      expect(result.text).toContain("PIN");
    });

    it("resaisie différente → annule, ne change jamais le PIN", async () => {
      const prisma = createFakePrisma({
        existingSession: existingSession({ state: "account_new_pin_confirm", contextData: { pendingPin: "5678" } }),
      });
      const ussdAccount = createFakeUssdAccount();
      const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, ussdAccount as any);

      const result = await service.handleRequest(SESSION_ID, PHONE, "0000");

      expect(ussdAccount.changePin).not.toHaveBeenCalled();
      expect(result.continue).toBe(false);
    });
  });

  describe("5.2 — voir mon palier", () => {
    it("choix 2 → affiche le palier résolu, aucun sous-état supplémentaire", async () => {
      const prisma = createFakePrisma({
        existingSession: existingSession({ state: "manage_account_menu", organizationId: ORG_ID }),
      });
      const ussdAccount = createFakeUssdAccount({ getTierSummary: vi.fn().mockResolvedValue("T2") });
      const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, ussdAccount as any);

      const result = await service.handleRequest(SESSION_ID, PHONE, "2");

      expect(ussdAccount.getTierSummary).toHaveBeenCalledWith(ORG_ID);
      expect(result).toEqual({ continue: false, text: "Votre palier actuel : T2" });
    });
  });

  describe("5.3 — mandats en attente (sélection par numéro)", () => {
    it("liste vide → message explicite", async () => {
      const prisma = createFakePrisma({
        existingSession: existingSession({ state: "manage_account_menu", organizationId: ORG_ID }),
      });
      const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, createFakeUssdAccount() as any);

      const result = await service.handleRequest(SESSION_ID, PHONE, "3");

      expect(result).toEqual({ continue: false, text: "Aucun mandat en attente." });
    });

    it("liste non vide → affiche les noms numérotés, demande un numéro", async () => {
      const prisma = createFakePrisma({
        existingSession: existingSession({ state: "manage_account_menu", organizationId: ORG_ID }),
      });
      const ussdAccount = createFakeUssdAccount({
        listPendingMandates: vi.fn().mockResolvedValue([{ id: "mandate-1", practice: { name: "Cabinet Mamadou" } }]),
      });
      const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, ussdAccount as any);

      const result = await service.handleRequest(SESSION_ID, PHONE, "3");

      expect(result.continue).toBe(true);
      expect(result.text).toContain("1. Cabinet Mamadou");
      expect(prisma.ussdSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            state: "account_mandate_select",
            contextData: expect.objectContaining({ mandateAction: "accept" }),
          }),
        }),
      );
    });

    it("numéro valide → accepte le mandat correspondant", async () => {
      const prisma = createFakePrisma({
        existingSession: existingSession({
          state: "account_mandate_select",
          contextData: { mandateAction: "accept", mandateOptions: [{ id: "mandate-1", name: "Cabinet Mamadou" }] },
          userId: USER_ID,
          organizationId: ORG_ID,
        }),
      });
      const ussdAccount = createFakeUssdAccount();
      const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, ussdAccount as any);

      const result = await service.handleRequest(SESSION_ID, PHONE, "1");

      expect(ussdAccount.acceptMandate).toHaveBeenCalledWith(ORG_ID, "mandate-1", USER_ID);
      expect(result.continue).toBe(false);
      expect(result.text).toContain("Cabinet Mamadou");
    });
  });

  describe("5.4 — mandats actifs (sélection par numéro)", () => {
    it("numéro valide → révoque le mandat correspondant", async () => {
      const prisma = createFakePrisma({
        existingSession: existingSession({
          state: "account_mandate_select",
          contextData: { mandateAction: "revoke", mandateOptions: [{ id: "mandate-1", name: "Cabinet Mamadou" }] },
          userId: USER_ID,
          organizationId: ORG_ID,
        }),
      });
      const ussdAccount = createFakeUssdAccount();
      const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, ussdAccount as any);

      const result = await service.handleRequest(SESSION_ID, PHONE, "1");

      expect(ussdAccount.revokeMandate).toHaveBeenCalledWith(ORG_ID, "mandate-1", USER_ID);
      expect(result.continue).toBe(false);
      expect(result.text).toContain("Cabinet Mamadou");
    });

    it("numéro hors plage → message d'échec, aucune action", async () => {
      const prisma = createFakePrisma({
        existingSession: existingSession({
          state: "account_mandate_select",
          contextData: { mandateAction: "revoke", mandateOptions: [{ id: "mandate-1", name: "Cabinet Mamadou" }] },
        }),
      });
      const ussdAccount = createFakeUssdAccount();
      const service = new UssdSessionService(prisma as any, createFakeUssdAuth() as any, createFakeVerification() as any, createFakeUssdInvoice() as any, createFakeUssdPayment() as any, createFakeUssdInvoiceList() as any, ussdAccount as any);

      const result = await service.handleRequest(SESSION_ID, PHONE, "9");

      expect(ussdAccount.revokeMandate).not.toHaveBeenCalled();
      expect(result.continue).toBe(false);
    });
  });
});
