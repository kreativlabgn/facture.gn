import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { IS_PUBLIC_KEY } from "../auth/public.decorator";
import { VerificationController } from "./verification.controller";

// Pas d'infra e2e (supertest) dans ce repo — on vérifie directement la métadonnée
// @Public() lue par JwtAuthGuard (voir jwt-auth.guard.spec.ts), qui est le mécanisme
// réel par lequel la route échappe au guard global.
describe("VerificationController", () => {
  it("expose GET /verify/:certificationId comme route @Public() (aucun JWT requis)", () => {
    const reflector = new Reflector();
    const isPublic = reflector.get(IS_PUBLIC_KEY, VerificationController.prototype.verify);

    expect(isPublic).toBe(true);
  });

  it("délègue au service avec le certificationId du paramètre d'URL", async () => {
    const service = { verifyByCertificationId: vi.fn().mockResolvedValue({ status: "issued" }) };
    const controller = new VerificationController(service as any);

    const result = await controller.verify("GN-GN123456-2026-ABCDEF");

    expect(service.verifyByCertificationId).toHaveBeenCalledWith("GN-GN123456-2026-ABCDEF");
    expect(result).toEqual({ status: "issued" });
  });
});
