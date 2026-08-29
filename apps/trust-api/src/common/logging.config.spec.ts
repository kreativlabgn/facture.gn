import { Writable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import pino from "pino";
import { Test } from "@nestjs/testing";
import { LoggerModule, PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";
import { loggerModuleParams, __test__ } from "./logging.config";

// Vague 0 (H1) — la redaction pino est configurée dans loggerModuleParams ; on
// la teste en instanciant un vrai logger pino avec cette config et en capturant
// la sortie JSON.
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

describe("logging.config — redaction PII", () => {
  it("censure les champs sensibles logués à la racine", () => {
    const out = captureLog({
      password: "hunter2",
      pinHash: "$argon2id$abc",
      nif: "123456789",
      signature: "deadbeef",
      secret: "s3cr3t",
      token: "eyJ...",
      encryptedPrivateKey: "base64...",
      bankAccountDetails: { iban: "GN..." },
    });

    expect(out.password).toBe("[redacted]");
    expect(out.pinHash).toBe("[redacted]");
    expect(out.nif).toBe("[redacted]");
    expect(out.signature).toBe("[redacted]");
    expect(out.secret).toBe("[redacted]");
    expect(out.token).toBe("[redacted]");
    expect(out.encryptedPrivateKey).toBe("[redacted]");
    expect(out.bankAccountDetails).toBe("[redacted]");
  });

  it("censure les champs sensibles imbriqués d'un niveau (ex. objet user/organization)", () => {
    const out = captureLog({
      user: { id: "u1", name: "Aissatou", passwordHash: "$argon2id$xyz", pinHash: "$argon2id$pin" },
      organization: { id: "o1", nif: "987654321", bankAccountDetails: { iban: "GN..." } },
    });

    const user = out.user as Record<string, unknown>;
    const org = out.organization as Record<string, unknown>;
    expect(user.passwordHash).toBe("[redacted]");
    expect(user.pinHash).toBe("[redacted]");
    expect(user.id).toBe("u1");
    expect(user.name).toBe("Aissatou");
    expect(org.nif).toBe("[redacted]");
    expect(org.bankAccountDetails).toBe("[redacted]");
    expect(org.id).toBe("o1");
  });

  it("censure les en-têtes d'authentification", () => {
    const out = captureLog({
      req: {
        method: "POST",
        url: "/invoices",
        headers: {
          authorization: "Bearer eyJhbGciOi...",
          "x-internal-api-key": "abcdef",
          "x-partner-signature": "hmac...",
          "content-type": "application/json",
        },
      },
    });

    const headers = ((out.req as Record<string, unknown>).headers) as Record<string, unknown>;
    expect(headers.authorization).toBe("[redacted]");
    expect(headers["x-internal-api-key"]).toBe("[redacted]");
    expect(headers["x-partner-signature"]).toBe("[redacted]");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("laisse intacts les champs non sensibles (montants, identifiants métier)", () => {
    const out = captureLog({
      invoiceId: "inv-1",
      organizationId: "org-1",
      totalTtc: "5000000",
      amountDue: "5000000",
      status: "issued",
      certificationId: "GN-12345678-2026-ABC123",
    });

    expect(out.invoiceId).toBe("inv-1");
    expect(out.totalTtc).toBe("5000000");
    expect(out.status).toBe("issued");
    expect(out.certificationId).toBe("GN-12345678-2026-ABC123");
  });
});

describe("logging.config — genReqId", () => {
  function fakeRes() {
    return { setHeader: vi.fn() } as unknown as ServerResponse;
  }

  it("réutilise l'en-tête x-request-id fourni par l'amont", () => {
    const req = { headers: { "x-request-id": "upstream-abc" } } as unknown as IncomingMessage;
    const res = fakeRes();

    expect(__test__.genReqId(req, res)).toBe("upstream-abc");
    expect(res.setHeader).toHaveBeenCalledWith("x-request-id", "upstream-abc");
  });

  it("génère un UUID quand aucun x-request-id n'est fourni", () => {
    const req = { headers: {} } as unknown as IncomingMessage;
    const res = fakeRes();

    const id = __test__.genReqId(req, res);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(res.setHeader).toHaveBeenCalledWith("x-request-id", id);
  });

  it("prend la première valeur si l'en-tête est un tableau", () => {
    const req = { headers: { "x-request-id": ["first", "second"] } } as unknown as IncomingMessage;
    expect(__test__.genReqId(req, fakeRes())).toBe("first");
  });
});

describe("logging.config — intégration nestjs-pino", () => {
  it("PinoLogger applique bien la redaction configurée (garde de non-régression de la lib)", async () => {
    const captured: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      captured.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const params = { ...loggerModuleParams, pinoHttp: { ...loggerModuleParams.pinoHttp, transport: undefined } };
      const moduleRef = await Test.createTestingModule({ imports: [LoggerModule.forRoot(params)] }).compile();
      const logger = await moduleRef.resolve(PinoLogger);
      logger.info({ password: "SECRET", user: { pinHash: "H" }, invoiceId: "inv-1" }, "integ");
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.stdout.write = originalWrite;
    }

    const line = captured.join("").split("\n").find((l) => l.includes("integ")) ?? "";
    expect(line).toContain('"password":"[redacted]"');
    expect(line).toContain('"pinHash":"[redacted]"');
    expect(line).toContain('"invoiceId":"inv-1"');
  });
});
