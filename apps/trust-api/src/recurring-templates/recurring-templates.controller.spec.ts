import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { ROLES_KEY } from "../common/rbac/roles.decorator";
import { ORGANIZATION_ID_SOURCE_KEY } from "../common/rbac/organization-id-source.decorator";
import { RecurringTemplatesController, RecurringTemplateGenerationController } from "./recurring-templates.controller";

const EXPECTED_ROLES = ["owner", "admin", "accountant_internal", "cashier", "field_agent"];

describe("RecurringTemplatesController — POST /organizations/:id/recurring-templates (I1, ADR-056)", () => {
  it("restreint la route au même trio élargi que la création de facture", () => {
    const reflector = new Reflector();
    const roles = reflector.get(ROLES_KEY, RecurringTemplatesController.prototype.create);

    expect(roles).toEqual(EXPECTED_ROLES);
  });

  it("résout l'organisation via idSource \"organization\" (:id = l'organisation, pas le modèle)", () => {
    const reflector = new Reflector();
    const idSource = reflector.get(ORGANIZATION_ID_SOURCE_KEY, RecurringTemplatesController.prototype.create);

    expect(idSource).toBe("organization");
  });

  it("délègue au service avec l'id d'organisation du paramètre d'URL", async () => {
    const service = { create: vi.fn().mockResolvedValue({ id: "template-1" }) };
    const controller = new RecurringTemplatesController(service as any);

    const dto = { lines: [{ description: "Abonnement", quantity: 1, unitPrice: 150_000n }], intervalDays: 30 };
    const result = await controller.create("org-1", dto as any);

    expect(service.create).toHaveBeenCalledWith("org-1", dto);
    expect(result.id).toBe("template-1");
  });
});

describe("RecurringTemplateGenerationController — POST /recurring-templates/:id/generate (I1, ADR-056)", () => {
  it("résout l'organisation via idSource \"recurring-template\" (:id = le modèle, pas l'organisation)", () => {
    const reflector = new Reflector();
    const idSource = reflector.get(
      ORGANIZATION_ID_SOURCE_KEY,
      RecurringTemplateGenerationController.prototype.generate,
    );

    expect(idSource).toBe("recurring-template");
  });

  it("délègue au service avec l'id de modèle du paramètre d'URL et l'utilisateur courant", async () => {
    const service = { generate: vi.fn().mockResolvedValue({ id: "invoice-1" }) };
    const controller = new RecurringTemplateGenerationController(service as any);

    const result = await controller.generate("template-1", { id: "user-1" } as any);

    expect(service.generate).toHaveBeenCalledWith("template-1", "user-1");
    expect(result.id).toBe("invoice-1");
  });
});
