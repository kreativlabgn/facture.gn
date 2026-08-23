import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RequireExplicitAuthGuard } from "./require-explicit-auth.guard";

function buildContext(isPublic: boolean | undefined) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(isPublic) } as any;
  const context: any = { getHandler: () => ({}), getClass: () => ({}) };
  return { reflector, context };
}

describe("RequireExplicitAuthGuard (Security Audit 2026-08-23, finding #16)", () => {
  it("laisse passer une route marquée @Public()", () => {
    const { reflector, context } = buildContext(true);
    const guard = new RequireExplicitAuthGuard(reflector);

    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejette (403) une route sans @Public() — tripwire deny-by-default", () => {
    const { reflector, context } = buildContext(undefined);
    const guard = new RequireExplicitAuthGuard(reflector);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
