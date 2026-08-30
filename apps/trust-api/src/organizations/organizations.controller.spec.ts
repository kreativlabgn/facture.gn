import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { IS_PUBLIC_KEY } from "../auth/public.decorator";
import { DgiVerificationAuthGuard } from "../common/dgi-verification-auth.guard";
import { ROLES_KEY } from "../common/rbac/roles.decorator";
import { ORGANIZATION_ID_SOURCE_KEY } from "../common/rbac/organization-id-source.decorator";
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
    const controller = new OrganizationsController(service as any, { inviteToOrganization: vi.fn(), listPendingForOrganization: vi.fn(), revokeForOrganization: vi.fn() } as any);

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
    const controller = new OrganizationsController(service as any, { inviteToOrganization: vi.fn(), listPendingForOrganization: vi.fn(), revokeForOrganization: vi.fn() } as any);

    await controller.listAuditLog("org-1", { category: "paiement" });

    expect(service.listAuditLog).toHaveBeenCalledWith("org-1", { category: "paiement" });
  });
});

describe("OrganizationsController — POST /organizations/:id/commercial-tier (H2, ADR-049)", () => {
  it("restreint la route à owner/admin", () => {
    const reflector = new Reflector();
    const roles = reflector.get(ROLES_KEY, OrganizationsController.prototype.upgradeCommercialTier);

    expect(roles).toEqual(["owner", "admin"]);
  });

  it("délègue au service avec l'id d'organisation du paramètre d'URL et le palier demandé", async () => {
    const service = { upgradeCommercialTier: vi.fn().mockResolvedValue({ id: "org-1", commercialTier: "pro" }) };
    const controller = new OrganizationsController(service as any, { inviteToOrganization: vi.fn(), listPendingForOrganization: vi.fn(), revokeForOrganization: vi.fn() } as any);

    const result = await controller.upgradeCommercialTier("org-1", { tier: "pro" });

    expect(service.upgradeCommercialTier).toHaveBeenCalledWith("org-1", "pro");
    expect(result.commercialTier).toBe("pro");
  });
});

describe("OrganizationsController — POST /organizations/:id/signing-key/revoke (A4, ADR-025)", () => {
  it("restreint la route à owner/admin", () => {
    const reflector = new Reflector();
    const roles = reflector.get(ROLES_KEY, OrganizationsController.prototype.revokeSigningKey);

    expect(roles).toEqual(["owner", "admin"]);
  });

  it("résout l'organisation via idSource \"organization\"", () => {
    const reflector = new Reflector();
    const idSource = reflector.get(ORGANIZATION_ID_SOURCE_KEY, OrganizationsController.prototype.revokeSigningKey);

    expect(idSource).toBe("organization");
  });

  it("délègue au service avec l'id d'organisation du paramètre d'URL", async () => {
    const service = { revokeSigningKey: vi.fn().mockResolvedValue({ id: "signing-key-1", revokedAt: new Date() }) };
    const controller = new OrganizationsController(service as any, { inviteToOrganization: vi.fn(), listPendingForOrganization: vi.fn(), revokeForOrganization: vi.fn() } as any);

    const result = await controller.revokeSigningKey("org-1");

    expect(service.revokeSigningKey).toHaveBeenCalledWith("org-1");
    expect(result.id).toBe("signing-key-1");
  });
});

describe("OrganizationsController — rotation de clé (E3, ADR-114)", () => {
  const pendingStub = { inviteToOrganization: vi.fn(), listPendingForOrganization: vi.fn(), revokeForOrganization: vi.fn() };

  it("POST /signing-key/rotate : owner/admin, idSource \"organization\", délègue", async () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_KEY, OrganizationsController.prototype.rotateSigningKey)).toEqual(["owner", "admin"]);
    expect(reflector.get(ORGANIZATION_ID_SOURCE_KEY, OrganizationsController.prototype.rotateSigningKey)).toBe("organization");

    const service = { rotateSigningKey: vi.fn().mockResolvedValue({ id: "key-2", publicKey: "pub2" }) };
    const controller = new OrganizationsController(service as any, pendingStub as any);

    const result = await controller.rotateSigningKey("org-1");

    expect(service.rotateSigningKey).toHaveBeenCalledWith("org-1");
    expect(result).not.toHaveProperty("encryptedPrivateKey");
  });

  it("GET /signing-key : owner/admin, idSource \"organization\", délègue", async () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_KEY, OrganizationsController.prototype.getSigningKeyStatus)).toEqual(["owner", "admin"]);
    expect(reflector.get(ORGANIZATION_ID_SOURCE_KEY, OrganizationsController.prototype.getSigningKeyStatus)).toBe("organization");

    const service = { getSigningKeyStatus: vi.fn().mockResolvedValue({ active: true, rotationDue: false }) };
    const controller = new OrganizationsController(service as any, pendingStub as any);

    expect(await controller.getSigningKeyStatus("org-1")).toMatchObject({ active: true });
    expect(service.getSigningKeyStatus).toHaveBeenCalledWith("org-1");
  });
});

// F10, revue post-fix #6 — les 3 nouvelles routes pending-invites n'avaient
// aucun test de délégation (seul le service PendingMemberInviteService était
// testé isolément).
describe("OrganizationsController — POST/GET .../pending-invites (F10)", () => {
  it("restreint invitePendingMember à owner/admin, résolu via idSource \"organization\"", () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_KEY, OrganizationsController.prototype.invitePendingMember)).toEqual([
      "owner",
      "admin",
    ]);
    expect(
      reflector.get(ORGANIZATION_ID_SOURCE_KEY, OrganizationsController.prototype.invitePendingMember),
    ).toBe("organization");
  });

  it("invitePendingMember délègue à PendingMemberInviteService.inviteToOrganization", async () => {
    const pendingMemberInviteService = {
      inviteToOrganization: vi.fn().mockResolvedValue({ id: "invite-1" }),
      listPendingForOrganization: vi.fn(),
      revokeForOrganization: vi.fn(),
    };
    const controller = new OrganizationsController({} as any, pendingMemberInviteService as any);

    const result = await controller.invitePendingMember(
      "org-1",
      { msisdn: "+224600000001", role: "cashier" },
      { id: "requester-1" } as any,
    );

    expect(pendingMemberInviteService.inviteToOrganization).toHaveBeenCalledWith(
      "org-1",
      { msisdn: "+224600000001", role: "cashier" },
      "requester-1",
    );
    expect(result).toEqual({ id: "invite-1" });
  });

  it("restreint listPendingInvites à owner/admin, résolu via idSource \"organization\"", () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_KEY, OrganizationsController.prototype.listPendingInvites)).toEqual([
      "owner",
      "admin",
    ]);
    expect(reflector.get(ORGANIZATION_ID_SOURCE_KEY, OrganizationsController.prototype.listPendingInvites)).toBe(
      "organization",
    );
  });

  it("listPendingInvites délègue à PendingMemberInviteService.listPendingForOrganization", async () => {
    const pendingMemberInviteService = {
      inviteToOrganization: vi.fn(),
      listPendingForOrganization: vi.fn().mockResolvedValue([{ id: "invite-1" }]),
      revokeForOrganization: vi.fn(),
    };
    const controller = new OrganizationsController({} as any, pendingMemberInviteService as any);

    const result = await controller.listPendingInvites("org-1");

    expect(pendingMemberInviteService.listPendingForOrganization).toHaveBeenCalledWith("org-1");
    expect(result).toEqual([{ id: "invite-1" }]);
  });

  it("restreint revokePendingInvite à owner/admin, résolu via idSource \"organization\"", () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_KEY, OrganizationsController.prototype.revokePendingInvite)).toEqual([
      "owner",
      "admin",
    ]);
    expect(reflector.get(ORGANIZATION_ID_SOURCE_KEY, OrganizationsController.prototype.revokePendingInvite)).toBe(
      "organization",
    );
  });

  it("revokePendingInvite délègue à PendingMemberInviteService.revokeForOrganization", async () => {
    const pendingMemberInviteService = {
      inviteToOrganization: vi.fn(),
      listPendingForOrganization: vi.fn(),
      revokeForOrganization: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new OrganizationsController({} as any, pendingMemberInviteService as any);

    await controller.revokePendingInvite("org-1", "invite-1");

    expect(pendingMemberInviteService.revokeForOrganization).toHaveBeenCalledWith("org-1", "invite-1");
  });
});
