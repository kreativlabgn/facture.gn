// Lot J (C5) — validation des secrets au démarrage.
//
// Aujourd'hui chaque secret est lu ad hoc via process.env, avec un fail-fast
// dispersé (un secret manquant à la fois). Problème réel : une valeur recopiée
// telle quelle depuis .env.example (`EXAMPLE0000…`) passe la plupart des
// contrôles « non vide » et démarre — secret trivialement devinable en prod.
//
// `assertSecretsValid` agrège TOUS les problèmes en une seule erreur au
// bootstrap (main.ts), AVANT NestFactory. Fonction pure, hors du graphe DI —
// aucun impact sur app.module.spec.ts.

export type SecretFormat = "hex64" | "hexMin32" | "pem" | "postgresUrl" | "redisUrl" | "httpUrl" | "any";

export interface SecretSpec {
  name: string;
  /** Requis même hors production (sinon l'app ne peut pas démmarrer utilement). */
  required: boolean;
  /** Requis en production même si `required` est faux (fallback dev toléré ailleurs). */
  requiredInProduction: boolean;
  format: SecretFormat;
  purpose: string;
}

const PLACEHOLDER = /^(example[0-9]*|changeme|placeholder|secret|todo|xx+)$/i;
const REPEATED_CHAR = /^(.)\1{15,}$/; // 16+ caractères identiques → gabarit

const FORMAT_CHECK: Record<SecretFormat, (v: string) => boolean> = {
  hex64: (v) => /^[0-9a-f]{64}$/i.test(v),
  hexMin32: (v) => /^[0-9a-f]{32,}$/i.test(v),
  pem: (v) => /-----BEGIN [A-Z0-9 ]+-----/.test(v) && /-----END [A-Z0-9 ]+-----/.test(v),
  postgresUrl: (v) => /^postgres(ql)?:\/\/.+/.test(v),
  redisUrl: (v) => /^rediss?:\/\/.+/.test(v),
  httpUrl: (v) => /^https?:\/\/.+/.test(v),
  any: (v) => v.length > 0,
};

const FORMAT_LABEL: Record<SecretFormat, string> = {
  hex64: "64 caractères hexadécimaux (openssl rand -hex 32)",
  hexMin32: "au moins 32 caractères hexadécimaux",
  pem: "bloc PEM (-----BEGIN … -----END …)",
  postgresUrl: "URL postgres:// ou postgresql://",
  redisUrl: "URL redis:// ou rediss://",
  httpUrl: "URL http:// ou https://",
  any: "valeur non vide",
};

function looksLikePlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (PLACEHOLDER.test(trimmed)) return true;
  if (REPEATED_CHAR.test(trimmed)) return true;
  // gabarit .env.example : "EXAMPLE" suivi de zéros/uns de bourrage
  if (/^example[01]+$/i.test(trimmed)) return true;
  return false;
}

export function validateSecrets(
  env: NodeJS.ProcessEnv,
  specs: readonly SecretSpec[],
  options: { production: boolean },
): string[] {
  const problems: string[] = [];

  for (const spec of specs) {
    const raw = env[spec.name];
    const value = raw?.trim() ?? "";
    const mustBePresent = spec.required || (options.production && spec.requiredInProduction);

    if (value === "") {
      if (mustBePresent) {
        problems.push(`${spec.name} manquant — ${spec.purpose}`);
      }
      continue;
    }

    if (looksLikePlaceholder(value)) {
      const detail = `${spec.name} a une valeur de gabarit (recopiée depuis .env.example ?) — ${spec.purpose}`;
      // Hors production on tolère (dev local), mais on le signale toujours.
      if (options.production) {
        problems.push(detail);
        continue;
      }
      // bootstrap, avant pino — console.
      console.warn(`[secrets] avertissement : ${detail}`);
    }

    if (!FORMAT_CHECK[spec.format](value)) {
      problems.push(`${spec.name} au mauvais format — attendu : ${FORMAT_LABEL[spec.format]}`);
    }
  }

  return problems;
}

export function assertSecretsValid(
  env: NodeJS.ProcessEnv,
  specs: readonly SecretSpec[],
  options: { production: boolean },
): void {
  const problems = validateSecrets(env, specs, options);
  if (problems.length > 0) {
    throw new Error(
      `Configuration des secrets invalide (${problems.length}) :\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        `\n\nVoir docs/runbooks/secrets-management.md.`,
    );
  }
}

// Inventaire des secrets Money API — source unique de vérité (repris par le runbook).
export const MONEY_API_SECRETS: readonly SecretSpec[] = [
  { name: "DATABASE_URL", required: true, requiredInProduction: true, format: "postgresUrl", purpose: "connexion PostgreSQL" },
  { name: "MONEY_API_INTERNAL_KEY", required: true, requiredInProduction: true, format: "hexMin32", purpose: "secret partagé trust-api ↔ money-api (C2)" },
  { name: "TRUST_API_URL", required: false, requiredInProduction: true, format: "httpUrl", purpose: "rappel de confirmation de paiement vers trust-api (C2 Phase 2b)" },
  { name: "REDIS_URL", required: false, requiredInProduction: true, format: "redisUrl", purpose: "BullMQ — worker de réconciliation des paiements (Lot E)" },
  { name: "DJOMY_WEBHOOK_STUB_SECRET", required: false, requiredInProduction: true, format: "hexMin32", purpose: "garde du webhook Djomy (stub, ADR-075)" },
  { name: "MONEROO_WEBHOOK_STUB_SECRET", required: false, requiredInProduction: true, format: "hexMin32", purpose: "garde du webhook Moneroo (stub, ADR-075)" },
];
