import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { IS_PUBLIC_KEY } from "../auth/public.decorator";
import { DgiVerificationAuthGuard } from "../common/dgi-verification-auth.guard";
import { ROLES_KEY } from "../common/rbac/roles.decorator";
import { OrganizationsController } from "./organizations.controller";

// '__guards__' est la clé interne @nestjs/common (GUARDS_METADATA, non exportée
// publiquement) lue par Nest pour résoudre les guards posés par @UseGuards() —
// même approche pragmatique que verification.controller.spec.ts pour IS_PUBLIC_KEY :
// pas d'infra e2e (supertest) dans ce repo, on vérifie directement la métadonnée.
const GUARDS_METADATA_KEY = "__guards__";

describe("OrganizationsController — POST /organizations/:id/verify-dgi (B2)", () => {
  it("expose la route comme @Public() — jamais le JWT organisationnel, l'organisation ne peut pas s'auto-vérifier", () => {
    const reflector = new Reflector();
    const isPublic = reflector.get(IS_PUBLIC_KEY, OrganizationsController.prototype.verifyDgi);

    expect(isPublic).toBe(true);
  });

  it("protège la route exclusivement par DgiVerificationAuthGuard", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA_KEY, OrganizationsController.prototype.verifyDgi);

    expect(guards).toEqual([DgiVerificationAuthGuard]);
  });

  it("délègue au service avec l'id d'organisation du paramètre d'URL", async () => {
    const service = { verifyDgi: vi.fn().mockResolvedValue({ dgiVerificationStatus: "verified" }) };
    const controller = new OrganizationsController(service as any);

    const result = await controller.verifyDgi("org-1");

    expect(service.verifyDgi).toHaveBeenCalledWith("org-1");
    expect(result).toEqual({ dgiVerificationStatus: "verified" });
  });
});

describe("OrganizationsController — GET /organizations/:id/audit-log (G4, ADR-097)", () => {
  it("restreint la route exactement à owner/admin/auditor — lecture seule, aucun rôle d'écriture", () => {
    const reflector = new Reflector();
    const roles = reflector.get(ROLES_KEY, OrganizationsController.prototype.listAuditLog);

    expect(roles).toEqual(["owner", "admin", "auditor"]);
  });

  it("délègue au service avec l'id d'organisation du paramètre d'URL et les filtres de la query", async () => {
    const service = { listAuditLog: vi.fn().mockResolvedValue([]) };
    const controller = new OrganizationsController(service as any);

    await controller.listAuditLog("org-1", { category: "paiement" });

    expect(service.listAuditLog).toHaveBeenCalledWith("org-1", { category: "paiement" });
  });
});
