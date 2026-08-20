import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { IS_PUBLIC_KEY } from "../auth/public.decorator";
import { CommissionBypassReviewAuthGuard } from "./commission-bypass-review-auth.guard";
import { CommissionBypassCasesController } from "./commission-bypass-cases.controller";

const GUARDS_METADATA_KEY = "__guards__";

describe("CommissionBypassCasesController — POST /organizations/:id/commission-bypass-cases (G3, ADR-091)", () => {
  it("expose la route comme @Public() — jamais un rôle organisationnel, Squad Money n'en est pas un", () => {
    const reflector = new Reflector();
    const isPublic = reflector.get(IS_PUBLIC_KEY, CommissionBypassCasesController.prototype.open);

    expect(isPublic).toBe(true);
  });

  it("protège la route exclusivement par CommissionBypassReviewAuthGuard", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA_KEY, CommissionBypassCasesController.prototype.open);

    expect(guards).toEqual([CommissionBypassReviewAuthGuard]);
  });

  it("délègue au service avec l'id d'organisation du paramètre d'URL et les patterns détectés", async () => {
    const service = { openCase: vi.fn().mockResolvedValue({ id: "case-1", status: "pending" }) };
    const controller = new CommissionBypassCasesController(service as any);

    const result = await controller.open("org-1", { detectedPatterns: ["round_amount"] });

    expect(service.openCase).toHaveBeenCalledWith("org-1", ["round_amount"]);
    expect(result.status).toBe("pending");
  });
});
