import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Params } from "nestjs-pino";

// Vague 0 (H1) — journalisation structurée + redaction PII systémique.
//
// La redaction pino agit par CHEMIN : elle couvre les champs sensibles connus,
// jamais un objet sensible logué sous une clé inattendue. Règle de complément,
// à respecter partout : ne jamais passer un enregistrement Prisma entier à un
// logger (voir CONTRIBUTING.md). Les chemins ci-dessous sont dérivés de
// packages/db/prisma/schema.prisma (tout champ *Hash / *Key / secret / pin /
// nif / signature / encryptedPrivateKey / bankAccountDetails) et des en-têtes
// d'authentification réels (jwt-auth.guard.ts, internal-auth.guard.ts,
// partner-webhook-auth.guard.ts).
const REDACT_PATHS: string[] = [
  // En-têtes d'authentification (niveau req et req.raw selon la version pino-http)
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-api-key"]',
  'req.headers["x-partner-key"]',
  'req.headers["x-partner-signature"]',
  'req.headers["x-request-id"]',
  // Corps / objets métier — un niveau
  "*.password",
  "*.passwordHash",
  "*.pin",
  "*.pinHash",
  "*.code",
  "*.codeHash",
  "*.otp",
  "*.secret",
  "*.apiKey",
  "*.keyHash",
  "*.keySuffix",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.jwt",
  "*.signature",
  "*.privateKey",
  "*.encryptedPrivateKey",
  "*.nif",
  "*.etaxNumber",
  "*.bankAccountDetails",
  "*.apiKeyHash",
  // Corps / objets métier — racine (objet logué directement)
  "password",
  "passwordHash",
  "pin",
  "pinHash",
  "code",
  "codeHash",
  "secret",
  "apiKey",
  "keyHash",
  "token",
  "signature",
  "privateKey",
  "encryptedPrivateKey",
  "nif",
  "bankAccountDetails",
  "authorization",
];

// x-request-id fourni par l'amont (gateway/ingress) réutilisé tel quel pour la
// corrélation bout-en-bout ; sinon un UUID v4 est généré. Jamais un compteur
// (non unique entre process).
function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const existing = req.headers["x-request-id"];
  const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
  res.setHeader("x-request-id", id);
  return id;
}

const isProduction = process.env.NODE_ENV === "production";

export const loggerModuleParams: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
    genReqId,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    // En prod : JSON brut sur stdout (collecté par Loki, DAT §Observabilité).
    // En dev : pino-pretty pour rester lisible en console.
    transport: isProduction
      ? undefined
      : { target: "pino-pretty", options: { singleLine: true, translateTime: "SYS:HH:MM:ss" } },
    // Le health check ne pollue pas les logs (bruit constant en k8s).
    autoLogging: {
      ignore: (req: IncomingMessage) => req.url === "/health" || req.url === "/health/ready" || req.url === "/health/live",
    },
    customProps: () => ({ service: "trust-api" }),
  },
  exclude: [],
};

export const __test__ = { REDACT_PATHS, genReqId };
