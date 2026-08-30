import { describe, expect, it, vi } from "vitest";

import {
  CLIENT_PORTAL_OTP_GRACE_MS,
  PENDING_MEMBER_INVITE_GRACE_MS,
  REVOKED_TOKEN_GRACE_MS,
  USSD_SESSION_GRACE_MS,
} from "./retention.constants";
import { RetentionService } from "./retention.service";

const NOW = new Date("2026-08-30T12:00:00.000Z");

function createFakePrisma() {
  return {
    ussdSession: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
    clientPortalOtp: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    revokedToken: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    pendingMemberInvite: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
}

function build(prismaOverrides: Partial<ReturnType<typeof createFakePrisma>> = {}) {
  const prisma = { ...createFakePrisma(), ...prismaOverrides };
  const deleted = { inc: vi.fn() };
  const errors = { inc: vi.fn() };
  const service = new RetentionService(prisma as never, deleted as never, errors as never);
  return { service, prisma, deleted, errors };
}

describe("RetentionService", () => {
  it("purge les 4 tables éphémères avec une borne expiresAt < now - délai de grâce", async () => {
    const { service, prisma } = build();

    await service.runOnce(NOW);

    expect(prisma.ussdSession.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date(NOW.getTime() - USSD_SESSION_GRACE_MS) } },
    });
    expect(prisma.clientPortalOtp.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date(NOW.getTime() - CLIENT_PORTAL_OTP_GRACE_MS) } },
    });
    expect(prisma.revokedToken.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date(NOW.getTime() - REVOKED_TOKEN_GRACE_MS) } },
    });
  });

  it("ne purge jamais une invitation déjà acceptée, même très ancienne", async () => {
    const { service, prisma } = build();

    await service.runOnce(NOW);

    expect(prisma.pendingMemberInvite.deleteMany).toHaveBeenCalledWith({
      where: {
        acceptedAt: null,
        expiresAt: { lt: new Date(NOW.getTime() - PENDING_MEMBER_INVITE_GRACE_MS) },
      },
    });
  });

  it("ne touche jamais assisted_session (preuve de consentement L/2016/037 — hors périmètre, F-H1)", async () => {
    const assistedSession = { deleteMany: vi.fn() };
    const { service } = build({ assistedSession } as never);

    await service.runOnce(NOW);

    expect(assistedSession.deleteMany).not.toHaveBeenCalled();
  });

  it("agrège le nombre de lignes supprimées par table et expose ruleCount", async () => {
    const { service } = build();

    const summary = await service.runOnce(NOW);

    expect(summary.deletedByTable).toEqual({
      ussd_session: 3,
      client_portal_otp: 0,
      revoked_token: 1,
      pending_member_invite: 0,
    });
    expect(summary.errored).toEqual([]);
    expect(summary.ruleCount).toBe(4);
  });

  it("incrémente le compteur de suppressions par table, y compris à 0 (série créée pour l'alerte 'plateau à 0')", async () => {
    const { service, deleted } = build();

    await service.runOnce(NOW);

    expect(deleted.inc).toHaveBeenCalledWith({ table: "ussd_session" }, 3);
    expect(deleted.inc).toHaveBeenCalledWith({ table: "revoked_token" }, 1);
    expect(deleted.inc).toHaveBeenCalledWith({ table: "client_portal_otp" }, 0);
    expect(deleted.inc).toHaveBeenCalledWith({ table: "pending_member_invite" }, 0);
  });

  it("une table en échec n'empêche pas les suivantes et incrémente le compteur d'erreurs", async () => {
    const { service, prisma, errors } = build({
      clientPortalOtp: {
        deleteMany: vi.fn().mockRejectedValue(new Error("connexion perdue")),
      },
    });

    const summary = await service.runOnce(NOW);

    expect(prisma.revokedToken.deleteMany).toHaveBeenCalled();
    expect(prisma.pendingMemberInvite.deleteMany).toHaveBeenCalled();
    expect(summary.errored).toEqual(["client_portal_otp"]);
    expect(summary.deletedByTable.client_portal_otp).toBeUndefined();
    expect(errors.inc).toHaveBeenCalledWith({ table: "client_portal_otp" });
  });

  it("ne rejette jamais, même si toutes les tables échouent (errored.length === ruleCount)", async () => {
    const failing = { deleteMany: vi.fn().mockRejectedValue(new Error("db down")) };
    const { service } = build({
      ussdSession: failing,
      clientPortalOtp: failing,
      revokedToken: failing,
      pendingMemberInvite: failing,
    });

    const summary = await service.runOnce(NOW);

    expect(summary.errored).toHaveLength(4);
    expect(summary.errored.length).toBe(summary.ruleCount);
  });
});
