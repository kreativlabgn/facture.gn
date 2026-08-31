import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";

import { IS_PUBLIC_KEY } from "../auth/public.decorator";
import { ROLES_KEY } from "../common/rbac/roles.decorator";
import { DataRightsController } from "./data-rights.controller";
import { InternalDataRightsController } from "./internal-data-rights.controller";

describe("DataRightsController (chemin PME)", () => {
  it("POST customers/data-rights/export réservé owner/admin, jamais @Public()", () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_KEY, DataRightsController.prototype.export)).toEqual(["owner", "admin"]);
    expect(reflector.get(IS_PUBLIC_KEY, DataRightsController.prototype.export)).toBeUndefined();
  });

  it("délègue l'export au service en scopant sur organizationId du body + l'acteur JWT", async () => {
    const service = { exportSubjectData: vi.fn().mockResolvedValue({ customers: [] }) };
    const controller = new DataRightsController(service as never);

    await controller.export(
      { organizationId: "11111111-1111-1111-1111-111111111111", phone: "+224620001122" },
      { id: "usr-7" } as never,
    );

    expect(service.exportSubjectData).toHaveBeenCalledWith({
      phone: "+224620001122",
      organizationId: "11111111-1111-1111-1111-111111111111",
      requestedByUserId: "usr-7",
    });
  });
});

describe("InternalDataRightsController (chemin ops plateforme)", () => {
  it("POST internal/data-rights/export est @Public() (hors JWT), derrière la clé interne", () => {
    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, InternalDataRightsController.prototype.export)).toBe(true);
    expect(reflector.get(ROLES_KEY, InternalDataRightsController.prototype.export)).toBeUndefined();
  });

  it("délègue l'export au service avec organizationId=null (portée transverse)", async () => {
    const service = { exportSubjectData: vi.fn().mockResolvedValue({ customers: [] }) };
    const controller = new InternalDataRightsController(service as never);

    await controller.export({ phone: "+224620001122" });

    expect(service.exportSubjectData).toHaveBeenCalledWith({ phone: "+224620001122", organizationId: null });
  });
});
