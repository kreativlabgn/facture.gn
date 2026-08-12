import { describe, expect, it, vi } from "vitest";
import { CabinetViewController } from "./cabinet-view.controller";

const ORG_ID = "org-1";
const USER = { id: "user-1" };

function createDeps(overrides: { assertAccess?: any } = {}) {
  return {
    organizationAccess: {
      assertAccess: overrides.assertAccess ?? vi.fn().mockResolvedValue(undefined),
    },
    invoicesService: {
      findAllByOrganization: vi.fn().mockResolvedValue([{ id: "invoice-1" }]),
    },
    customersService: {
      findAllByOrganization: vi.fn().mockResolvedValue([{ id: "customer-1" }]),
    },
  };
}

describe("CabinetViewController — GET /organizations/:id/invoices", () => {
  it("vérifie l'accès (membership ou mandat) avant de lire les factures", async () => {
    const deps = createDeps();
    const controller = new CabinetViewController(deps.invoicesService as any, deps.customersService as any, deps.organizationAccess as any);

    const result = await controller.listInvoices(ORG_ID, USER as any);

    expect(deps.organizationAccess.assertAccess).toHaveBeenCalledWith(ORG_ID, USER.id, [
      "owner",
      "admin",
      "accountant_internal",
      "cashier",
      "field_agent",
    ]);
    expect(deps.invoicesService.findAllByOrganization).toHaveBeenCalledWith(ORG_ID, {});
    expect(result).toEqual([{ id: "invoice-1" }]);
  });

  it("ne lit jamais les factures si l'accès est refusé", async () => {
    const deps = createDeps({ assertAccess: vi.fn().mockRejectedValue(new Error("Aucun accès")) });
    const controller = new CabinetViewController(deps.invoicesService as any, deps.customersService as any, deps.organizationAccess as any);

    await expect(controller.listInvoices(ORG_ID, USER as any)).rejects.toThrow("Aucun accès");
    expect(deps.invoicesService.findAllByOrganization).not.toHaveBeenCalled();
  });
});

describe("CabinetViewController — GET /organizations/:id/customers", () => {
  it("vérifie l'accès (membership ou mandat) avant de lire les clients", async () => {
    const deps = createDeps();
    const controller = new CabinetViewController(deps.invoicesService as any, deps.customersService as any, deps.organizationAccess as any);

    const result = await controller.listCustomers(ORG_ID, USER as any);

    expect(deps.organizationAccess.assertAccess).toHaveBeenCalledWith(ORG_ID, USER.id, [
      "owner",
      "admin",
      "accountant_internal",
      "cashier",
      "field_agent",
    ]);
    expect(deps.customersService.findAllByOrganization).toHaveBeenCalledWith(ORG_ID, {});
    expect(result).toEqual([{ id: "customer-1" }]);
  });

  it("ne lit jamais les clients si l'accès est refusé", async () => {
    const deps = createDeps({ assertAccess: vi.fn().mockRejectedValue(new Error("Aucun accès")) });
    const controller = new CabinetViewController(deps.invoicesService as any, deps.customersService as any, deps.organizationAccess as any);

    await expect(controller.listCustomers(ORG_ID, USER as any)).rejects.toThrow("Aucun accès");
    expect(deps.customersService.findAllByOrganization).not.toHaveBeenCalled();
  });
});
