import { describe, expect, it, vi } from "vitest";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { PlatformAdminGuard } from "./platform-admin.guard";

function context(user?: { id?: string }) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

describe("PlatformAdminGuard", () => {
  it("refuse une requête sans identité JWT", async () => {
    const prisma = { user: { findUnique: vi.fn() } };
    const guard = new PlatformAdminGuard(prisma as never);

    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("refuse un utilisateur non administrateur plateforme", async () => {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue({ isPlatformAdmin: false }) } };
    const guard = new PlatformAdminGuard(prisma as never);

    await expect(guard.canActivate(context({ id: "user-1" }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { isPlatformAdmin: true },
    });
  });

  it("autorise un administrateur plateforme actif", async () => {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue({ isPlatformAdmin: true }) } };
    const guard = new PlatformAdminGuard(prisma as never);

    await expect(guard.canActivate(context({ id: "user-1" }))).resolves.toBe(true);
  });

  it("réévalue le flag en base à chaque requête", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ isPlatformAdmin: true })
      .mockResolvedValueOnce({ isPlatformAdmin: false });
    const guard = new PlatformAdminGuard({ user: { findUnique } } as never);

    await expect(guard.canActivate(context({ id: "user-1" }))).resolves.toBe(true);
    await expect(guard.canActivate(context({ id: "user-1" }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
