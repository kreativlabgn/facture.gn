import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { InternalAuthGuard } from "../common/internal-auth.guard";
import { PaymentLinksController } from "./payment-links.controller";

// '__guards__' est la clé interne @nestjs/common (GUARDS_METADATA, non exportée
// publiquement) lue par Nest pour résoudre les guards posés par @UseGuards() —
// même approche que organizations.controller.spec.ts (trust-api) : pas
// d'infra e2e (supertest) dans ce repo, on vérifie directement la métadonnée.
const GUARDS_METADATA_KEY = "__guards__";

describe("PaymentLinksController — placement des guards (C19)", () => {
  it("protège POST / (create, inter-service) par InternalAuthGuard", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA_KEY, PaymentLinksController.prototype.create);

    expect(guards).toEqual([InternalAuthGuard]);
  });

  it("n'applique AUCUN guard sur GET :invoiceId/checkout — route publique pour le payeur", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA_KEY, PaymentLinksController.prototype.getPublicCheckout);

    expect(guards).toBeUndefined();
  });

  it("délègue getPublicCheckout au service avec l'invoiceId du paramètre d'URL", async () => {
    const service = { getPublicCheckout: vi.fn().mockResolvedValue({ provider: "djomy" }) };
    const controller = new PaymentLinksController(service as any);

    const result = await controller.getPublicCheckout("inv-1");

    expect(service.getPublicCheckout).toHaveBeenCalledWith("inv-1");
    expect(result).toEqual({ provider: "djomy" });
  });
});
