import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Params } from "nestjs-pino";

// Vague 0 (H1) — journalisation structurée + redaction PII systémique.
// Duplication assumée avec apps/trust-api/src/common/logging.config.ts (même
// précédent que common/prisma.module.ts / internal-auth.guard.ts) : pas de
// package d'app partagé, et les listes de chemins divergent légèrement (money
// manipule des refs provider, pas de NIF ni de PIN).
//
// La redaction agit par CHEMIN — ne jamais loguer un objet provider/paiement
// entier (voir CONTRIBUTING.md).
const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-api-key"]',
  'req.headers["x-webhook-secret"]',
  'req.headers["x-djomy-signature"]',
  'req.headers["x-moneroo-signature"]',
  "*.secret",
  "*.apiKey",
  "*.token",
  "*.accessToken",
  "*.signature",
  "*.webhookSecret",
  "*.authorization",
  "secret",
  "apiKey",
  "token",
  "signature",
  "webhookSecret",
  "authorization",
  // Défense en profondeur — money-api n'a pas ces champs dans son propre
  // domaine, mais un objet forwardé depuis trust-api pourrait en contenir.
  // Coût nul, ferme le risque « quelqu'un logue un objet user ici un jour ».
  "*.password",
  "*.passwordHash",
  "*.pin",
  "*.pinHash",
  "*.nif",
  "*.keyHash",
  "*.privateKey",
  "*.encryptedPrivateKey",
  "password",
  "passwordHash",
  "pin",
  "pinHash",
  "nif",
  // rawPayload d'un webhook provider : peut contenir des identifiants de compte
  // Mobile Money du payeur — jamais logué en clair.
  "rawPayload",
  "*.rawPayload",
  "payload",
  "*.payload",
];

function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const existing = req.headers["x-request-id"];
  const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
  res.setHeader("x-request-id", id);
  return id;
}

const isProduction = process.env.NODE_ENV === "production";

// Voir apps/trust-api/src/common/logging.config.ts : JSON par défaut, pino-pretty
// activé seulement s'il est réellement installé (devDependency).
function isPrettyLoggerAvailable(): boolean {
  if (isProduction || process.env.LOG_PRETTY === "false") return false;
  try {
    require.resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}
const usePrettyLogs = isPrettyLoggerAvailable();

export const loggerModuleParams: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
    genReqId,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    transport: usePrettyLogs
      ? { target: "pino-pretty", options: { singleLine: true, translateTime: "SYS:HH:MM:ss" } }
      : undefined,
    autoLogging: {
      ignore: (req: IncomingMessage) => req.url === "/health" || req.url === "/health/ready" || req.url === "/health/live",
    },
    customProps: () => ({ service: "money-api" }),
  },
};

export const __test__ = { REDACT_PATHS, genReqId };
