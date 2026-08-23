import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { IS_PUBLIC_KEY } from "../common/public.decorator";
import { WebhooksController } from "./webhooks.controller";

describe("WebhooksController — @Public() (Security Audit 2026-08-23, finding #16)", () => {
  it("POST :provider porte @Public() — public par conception, l'auth vit dans WebhooksService (signature du payload)", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, WebhooksController.prototype.receive)).toBe(true);
  });
});
