import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";

import { IS_PUBLIC_KEY } from "../auth/public.decorator";
import { ORGANIZATION_ID_SOURCE_KEY } from "../common/rbac/organization-id-source.decorator";
import { ROLES_KEY } from "../common/rbac/roles.decorator";
import { BankReconciliationController } from "./bank-reconciliation.controller";

const ROLES = ["owner", "admin", "accountant_internal"];
const HANDLERS = ["import", "listTransactions", "confirm", "ignore"] as const;

describe("BankReconciliationController — RBAC", () => {
  const reflector = new Reflector();

  it("les 4 routes sont réservées owner/admin/accountant_internal et jamais @Public()", () => {
    for (const handler of HANDLERS) {
      const fn = BankReconciliationController.prototype[handler];
      expect(reflector.get(ROLES_KEY, fn)).toEqual(ROLES);
      expect(reflector.get(IS_PUBLIC_KEY, fn)).toBeUndefined();
    }
  });

  it("les 4 routes résolvent l'organisation depuis le path param (idSource organization)", () => {
    for (const handler of HANDLERS) {
      expect(
        reflector.get(ORGANIZATION_ID_SOURCE_KEY, BankReconciliationController.prototype[handler]),
      ).toBe("organization");
    }
  });
});

describe("BankReconciliationController — délégation", () => {
  function build() {
    const service = {
      importTransactions: vi.fn().mockResolvedValue({ importBatchId: "b1", imported: 1, duplicate: 0 }),
      listTransactions: vi.fn().mockResolvedValue([]),
      confirmMatch: vi.fn().mockResolvedValue({}),
      ignoreTransaction: vi.fn().mockResolvedValue({}),
    };
    return { service, controller: new BankReconciliationController(service as never) };
  }

  it("import → importTransactions(orgId, dto, user.id)", async () => {
    const { service, controller } = build();
    const dto = { transactions: [] } as never;
    await controller.import("org-1", dto, { id: "usr-7" } as never);
    expect(service.importTransactions).toHaveBeenCalledWith("org-1", dto, "usr-7");
  });

  it("listTransactions → listTransactions(orgId, query)", async () => {
    const { service, controller } = build();
    await controller.listTransactions("org-1", { state: "unmatched" } as never);
    expect(service.listTransactions).toHaveBeenCalledWith("org-1", { state: "unmatched" });
  });

  it("confirm → confirmMatch(orgId, transactionId, dto.invoiceId, user.id)", async () => {
    const { service, controller } = build();
    await controller.confirm("org-1", "bt-1", { invoiceId: "inv-1" } as never, { id: "usr-7" } as never);
    expect(service.confirmMatch).toHaveBeenCalledWith("org-1", "bt-1", "inv-1", "usr-7");
  });

  it("ignore → ignoreTransaction(orgId, transactionId, user.id)", async () => {
    const { service, controller } = build();
    await controller.ignore("org-1", "bt-1", { id: "usr-7" } as never);
    expect(service.ignoreTransaction).toHaveBeenCalledWith("org-1", "bt-1", "usr-7");
  });
});
