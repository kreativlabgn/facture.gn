import { describe, expect, it, vi } from "vitest";
import { FiscalPeriodsController } from "./fiscal-periods.controller";

describe("FiscalPeriodsController", () => {
  it("POST close délègue au service avec organisation, année et utilisateur courant", async () => {
    const service = { close: vi.fn().mockResolvedValue({ id: "fpc-1", year: 2025 }) };
    const controller = new FiscalPeriodsController(service as never);

    const result = await controller.close("org-1", 2025, { id: "user-comptable" } as never);

    expect(service.close).toHaveBeenCalledWith("org-1", 2025, "user-comptable");
    expect(result).toEqual({ id: "fpc-1", year: 2025 });
  });

  it("GET list délègue au service avec l'organisation", async () => {
    const service = { listByOrganization: vi.fn().mockResolvedValue([{ year: 2025 }]) };
    const controller = new FiscalPeriodsController(service as never);

    const result = await controller.list("org-1");

    expect(service.listByOrganization).toHaveBeenCalledWith("org-1");
    expect(result).toEqual([{ year: 2025 }]);
  });
});
