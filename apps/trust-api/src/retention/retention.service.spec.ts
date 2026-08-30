import { describe, expect, it, vi } from "vitest";

import {
  ASSISTED_SESSION_REVOKED_GRACE_MS,
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
    assistedSession: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
}

function build(prismaOverrides: Partial<ReturnType<typeof createFakePrisma>> = {}) {
  const prisma = { ...createFakePrisma(), ...prismaOverrides };
  const counter = { inc: vi.fn() };
  const service = new RetentionService(prisma as never, counter as never);
  return { service, prisma, counter };
}

describe("RetentionService", () => {
  it("purge les 5 tables avec une borne expiresAt < now - délai de grâce", async () => {
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

  it("ne purge une assisted_session que si elle a été RÉVOQUÉE depuis longtemps — jamais sur la seule expiration (preuve de consentement)", async () => {
    const { service, prisma } = build();

    await service.runOnce(NOW);

    expect(prisma.assistedSession.deleteMany).toHaveBeenCalledWith({
      where: {
        revokedAt: { not: null, lt: new Date(NOW.getTime() - ASSISTED_SESSION_REVOKED_GRACE_MS) },
      },
    });
  });

  it("agrège le nombre de lignes supprimées par table", async () => {
    const { service } = build();

    const summary = await service.runOnce(NOW);

    expect(summary.deletedByTable).toEqual({
      ussd_session: 3,
      client_portal_otp: 0,
      revoked_token: 1,
      pending_member_invite: 0,
      assisted_session: 2,
    });
    expect(summary.errored).toEqual([]);
  });

  it("incrémente le compteur Prometheus par table, uniquement quand des lignes ont été supprimées", async () => {
    const { service, counter } = build();

    await service.runOnce(NOW);

    expect(counter.inc).toHaveBeenCalledWith({ table: "ussd_session" }, 3);
    expect(counter.inc).toHaveBeenCalledWith({ table: "revoked_token" }, 1);
    expect(counter.inc).toHaveBeenCalledWith({ table: "assisted_session" }, 2);
    expect(counter.inc).not.toHaveBeenCalledWith({ table: "client_portal_otp" }, 0);
    expect(counter.inc).not.toHaveBeenCalledWith({ table: "pending_member_invite" }, 0);
  });

  it("une table en échec n'empêche pas les suivantes d'être purgées", async () => {
    const { service, prisma } = build({
      clientPortalOtp: {
        deleteMany: vi.fn().mockRejectedValue(new Error("connexion perdue")),
      },
    });

    const summary = await service.runOnce(NOW);

    expect(prisma.revokedToken.deleteMany).toHaveBeenCalled();
    expect(prisma.pendingMemberInvite.deleteMany).toHaveBeenCalled();
    expect(prisma.assistedSession.deleteMany).toHaveBeenCalled();
    expect(summary.errored).toEqual(["client_portal_otp"]);
    expect(summary.deletedByTable.client_portal_otp).toBeUndefined();
  });

  it("ne rejette jamais, même si toutes les tables échouent", async () => {
    const failing = { deleteMany: vi.fn().mockRejectedValue(new Error("db down")) };
    const { service } = build({
      ussdSession: failing,
      clientPortalOtp: failing,
      revokedToken: failing,
      pendingMemberInvite: failing,
      assistedSession: failing,
    });

    const summary = await service.runOnce(NOW);

    expect(summary.errored).toHaveLength(5);
  });
});
