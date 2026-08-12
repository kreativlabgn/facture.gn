import { describe, expect, it, vi } from "vitest";
import { UssdSessionService } from "./ussd-session.service";

const SESSION_ID = "ATUid_abc123";
const PHONE = "+224622334455";

function createFakePrisma(overrides: { existingSession?: any } = {}) {
  return {
    ussdSession: {
      findUnique: vi.fn().mockResolvedValue(overrides.existingSession ?? null),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "session-row-1", ...data })),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "session-row-1", ...data })),
    },
  };
}

describe("UssdSessionService — menu racine (§1 Spec USSD)", () => {
  it("crée une session neuve à l'état root et affiche le menu canonique quand sessionId est inconnu", async () => {
    const prisma = createFakePrisma();
    const service = new UssdSessionService(prisma as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "");

    expect(prisma.ussdSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sessionId: SESSION_ID, phone: PHONE, state: "root" }) }),
    );
    expect(result.continue).toBe(true);
    expect(result.text).toContain("Payer une facture");
    expect(result.text).toContain("Émettre une facture");
  });

  it("recharge une session existante par sessionId au lieu d'en recréer une", async () => {
    const prisma = createFakePrisma({
      existingSession: {
        id: "session-row-1",
        sessionId: SESSION_ID,
        phone: PHONE,
        state: "root",
        contextData: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const service = new UssdSessionService(prisma as any);

    await service.handleRequest(SESSION_ID, PHONE, "");

    expect(prisma.ussdSession.create).not.toHaveBeenCalled();
  });

  it("recrée une session neuve si la précédente a expiré, jamais une erreur", async () => {
    const prisma = createFakePrisma({
      existingSession: {
        id: "session-row-1",
        sessionId: SESSION_ID,
        phone: PHONE,
        state: "root",
        contextData: null,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const service = new UssdSessionService(prisma as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "");

    expect(prisma.ussdSession.create).toHaveBeenCalled();
    expect(result.continue).toBe(true);
  });

  it("répond 'bientôt disponible' pour un choix 1 à 5 à l'état root (branches à venir)", async () => {
    const prisma = createFakePrisma({
      existingSession: {
        id: "session-row-1",
        sessionId: SESSION_ID,
        phone: PHONE,
        state: "root",
        contextData: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const service = new UssdSessionService(prisma as any);

    const result = await service.handleRequest(SESSION_ID, PHONE, "1");

    expect(result.continue).toBe(false);
    expect(result.text).toContain("bientôt disponible");
  });
});
