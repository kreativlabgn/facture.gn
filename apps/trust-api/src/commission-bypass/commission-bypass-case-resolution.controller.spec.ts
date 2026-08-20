import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { IS_PUBLIC_KEY } from "../auth/public.decorator";
import { CommissionBypassReviewAuthGuard } from "./commission-bypass-review-auth.guard";
import { CommissionBypassCaseResolutionController } from "./commission-bypass-case-resolution.controller";

const GUARDS_METADATA_KEY = "__guards__";

describe("CommissionBypassCaseResolutionController — POST /commission-bypass-cases/:id/resolve (G3, ADR-091)", () => {
  it("expose la route comme @Public() — jamais un rôle organisationnel, Squad Money n'en est pas un", () => {
    const reflector = new Reflector();
    const isPublic = reflector.get(IS_PUBLIC_KEY, CommissionBypassCaseResolutionController.prototype.resolve);

    expect(isPublic).toBe(true);
  });

  it("protège la route exclusivement par CommissionBypassReviewAuthGuard", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA_KEY,
      CommissionBypassCaseResolutionController.prototype.resolve,
    );

    expect(guards).toEqual([CommissionBypassReviewAuthGuard]);
  });

  it("délègue au service avec l'id du case et la décision", async () => {
    const service = { resolveCase: vi.fn().mockResolvedValue({ id: "case-1", status: "dismissed" }) };
    const controller = new CommissionBypassCaseResolutionController(service as any);

    const result = await controller.resolve("case-1", { decision: "dismiss" });

    expect(service.resolveCase).toHaveBeenCalledWith("case-1", "dismiss");
    expect(result.status).toBe("dismissed");
  });
});
