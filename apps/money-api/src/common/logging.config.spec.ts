import { Writable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { loggerModuleParams, __test__ } from "./logging.config";

function captureLog(obj: Record<string, unknown>, msg = "test"): Record<string, unknown> {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const redact = (loggerModuleParams.pinoHttp as { redact: pino.redactOptions }).redact;
  const logger = pino({ redact, base: null }, stream);
  logger.info(obj, msg);
  return JSON.parse(lines.join("").trim()) as Record<string, unknown>;
}

describe("logging.config (money-api) — redaction", () => {
  it("censure secrets, signatures et payloads de webhook", () => {
    const out = captureLog({
      secret: "s3cr3t",
      signature: "hmac...",
      webhookSecret: "whsec_...",
      rawPayload: { msisdn: "+224...", amount: 5000 },
      attempt: { id: "a1", providerRef: "PR-123", token: "tok_..." },
    });

    expect(out.secret).toBe("[redacted]");
    expect(out.signature).toBe("[redacted]");
    expect(out.webhookSecret).toBe("[redacted]");
    expect(out.rawPayload).toBe("[redacted]");
    const attempt = out.attempt as Record<string, unknown>;
    expect(attempt.token).toBe("[redacted]");
    expect(attempt.providerRef).toBe("PR-123");
  });

  it("censure les en-têtes d'authentification et de webhook", () => {
    const out = captureLog({
      req: {
        headers: {
          authorization: "Bearer ...",
          "x-internal-api-key": "abc",
          "x-djomy-signature": "sig",
          "content-type": "application/json",
        },
      },
    });
    const headers = ((out.req as Record<string, unknown>).headers) as Record<string, unknown>;
    expect(headers.authorization).toBe("[redacted]");
    expect(headers["x-internal-api-key"]).toBe("[redacted]");
    expect(headers["x-djomy-signature"]).toBe("[redacted]");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("censure aussi les champs sensibles d'un objet forwardé depuis trust-api (défense en profondeur)", () => {
    const out = captureLog({ forwarded: { password: "x", pinHash: "$argon2id$", nif: "123" } });
    const fwd = out.forwarded as Record<string, unknown>;
    expect(fwd.password).toBe("[redacted]");
    expect(fwd.pinHash).toBe("[redacted]");
    expect(fwd.nif).toBe("[redacted]");
  });

  it("laisse intacts les identifiants métier non sensibles", () => {
    const out = captureLog({ invoiceId: "inv-1", provider: "djomy", amountGnf: "5000000", status: "success" });
    expect(out.invoiceId).toBe("inv-1");
    expect(out.provider).toBe("djomy");
    expect(out.amountGnf).toBe("5000000");
  });
});

describe("logging.config (money-api) — genReqId", () => {
  const fakeRes = () => ({ setHeader: vi.fn() }) as unknown as ServerResponse;

  it("réutilise x-request-id s'il est présent", () => {
    const req = { headers: { "x-request-id": "abc" } } as unknown as IncomingMessage;
    expect(__test__.genReqId(req, fakeRes())).toBe("abc");
  });

  it("génère un UUID sinon", () => {
    const req = { headers: {} } as unknown as IncomingMessage;
    expect(__test__.genReqId(req, fakeRes())).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
