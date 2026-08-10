import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PartnersController } from "./partners.controller";

const APIP_DTO = {
  name: "Boutique Kaloum SARL",
  regimeFiscal: "normal_tva" as const,
  legalForm: "commercial" as const,
  nif: "GN99887766",
  rccm: "GC-KAL-2026-A-001",
};

describe("PartnersController — POST /v1/partners/:partnerType/:event (F11, ADR-077)", () => {
  it("délègue à createFromApip pour apip/company-created", async () => {
    const service = { createFromApip: vi.fn().mockResolvedValue({ id: "org-1" }) };
    const controller = new PartnersController(service as any);

    const result = await controller.handleEvent("apip", "company-created", APIP_DTO);

    expect(service.createFromApip).toHaveBeenCalledWith(APIP_DTO);
    expect(result).toEqual({ id: "org-1" });
  });

  it("refuse (404) un partnerType différent de apip — fodip/3ae n'ont aucune intégration technique (ADR-078)", () => {
    const service = { createFromApip: vi.fn() };
    const controller = new PartnersController(service as any);

    expect(() => controller.handleEvent("fodip", "company-created", APIP_DTO)).toThrow(NotFoundException);
    expect(service.createFromApip).not.toHaveBeenCalled();
  });

  it("refuse (404) un event différent de company-created", () => {
    const service = { createFromApip: vi.fn() };
    const controller = new PartnersController(service as any);

    expect(() => controller.handleEvent("apip", "company-updated", APIP_DTO)).toThrow(NotFoundException);
    expect(service.createFromApip).not.toHaveBeenCalled();
  });
});
