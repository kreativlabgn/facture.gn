import { describe, expect, it, vi } from "vitest";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

import { RedactingSpanProcessor, redactSpanAttributes } from "./redacting-span-processor";

describe("redactSpanAttributes", () => {
  it("supprime les attributs dont la clé porte un terme sensible (insensible à la casse)", () => {
    const attrs: Record<string, unknown> = {
      "http.request.header.authorization": "Bearer secret-token",
      "http.request.header.Cookie": "session=abc",
      "db.statement": "SELECT * FROM users WHERE pin = '4821'",
      "custom.userPin": "1234",
      "org.nif": "123456789",
      "x-partner-signature": "deadbeef",
    };
    redactSpanAttributes(attrs);
    expect(attrs["http.request.header.authorization"]).toBe("[redacted]");
    expect(attrs["http.request.header.Cookie"]).toBe("[redacted]");
    expect(attrs["db.statement"]).toBe("[redacted]");
    expect(attrs["custom.userPin"]).toBe("[redacted]");
    expect(attrs["org.nif"]).toBe("[redacted]");
    expect(attrs["x-partner-signature"]).toBe("[redacted]");
  });

  it("conserve les attributs anodins", () => {
    const attrs: Record<string, unknown> = {
      "http.method": "POST",
      "http.status_code": 201,
      "net.peer.name": "money-api",
    };
    redactSpanAttributes(attrs);
    expect(attrs).toEqual({
      "http.method": "POST",
      "http.status_code": 201,
      "net.peer.name": "money-api",
    });
  });

  it("garde le chemin mais efface la query string des attributs d'URL", () => {
    const attrs: Record<string, unknown> = {
      "http.url": "https://api.facture.gn/pay/inv_123?token=leaky&otp=999",
      "http.target": "/invoices/42",
    };
    redactSpanAttributes(attrs);
    expect(attrs["http.url"]).toBe("https://api.facture.gn/pay/inv_123?[redacted]");
    expect(attrs["http.target"]).toBe("/invoices/42");
  });
});

describe("RedactingSpanProcessor", () => {
  const makeInner = (): SpanProcessor => ({
    onStart: vi.fn(),
    onEnd: vi.fn(),
    forceFlush: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  });

  it("nettoie les attributs du span avant de le transmettre au processor interne", () => {
    const inner = makeInner();
    const processor = new RedactingSpanProcessor(inner);
    const span = { attributes: { "db.statement": "SELECT 1", "http.method": "GET" } } as unknown as ReadableSpan;

    processor.onEnd(span);

    expect((span.attributes as Record<string, unknown>)["db.statement"]).toBe("[redacted]");
    expect((span.attributes as Record<string, unknown>)["http.method"]).toBe("GET");
    expect(inner.onEnd).toHaveBeenCalledWith(span);
  });

  it("délègue onStart / forceFlush / shutdown au processor interne", async () => {
    const inner = makeInner();
    const processor = new RedactingSpanProcessor(inner);
    const span = {} as Span;
    const ctx = {} as never;

    processor.onStart(span, ctx);
    await processor.forceFlush();
    await processor.shutdown();

    expect(inner.onStart).toHaveBeenCalledWith(span, ctx);
    expect(inner.forceFlush).toHaveBeenCalledOnce();
    expect(inner.shutdown).toHaveBeenCalledOnce();
  });
});
