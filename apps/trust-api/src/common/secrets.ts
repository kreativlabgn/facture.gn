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

// Inventaire des secrets Trust API — source unique de vérité (repris par le
// runbook). `requiredInProduction` sans `required` = un fallback de dev existe
// (clé aléatoire, secret partagé toléré) mais est inacceptable en prod.
export const TRUST_API_SECRETS: readonly SecretSpec[] = [
  { name: "DATABASE_URL", required: true, requiredInProduction: true, format: "postgresUrl", purpose: "connexion PostgreSQL" },
  { name: "JWT_PRIVATE_KEY", required: true, requiredInProduction: true, format: "pem", purpose: "signature des JWT (RS256, ADR-011)" },
  { name: "JWT_PUBLIC_KEY", required: true, requiredInProduction: true, format: "pem", purpose: "vérification des JWT" },
  { name: "CERTIFICATION_PRIVATE_KEY", required: true, requiredInProduction: true, format: "hex64", purpose: "clé Ed25519 légataire (vérification des factures signées avant les clés par organisation, ADR-026)" },
  { name: "CERTIFICATION_MASTER_KEY", required: true, requiredInProduction: true, format: "hex64", purpose: "chiffrement enveloppe des clés Ed25519 par organisation (A3, ADR-026)" },
  { name: "MONEY_API_INTERNAL_KEY", required: true, requiredInProduction: true, format: "hexMin32", purpose: "secret partagé trust-api ↔ money-api (C2)" },
  { name: "DGI_VERIFICATION_INTERNAL_KEY", required: false, requiredInProduction: true, format: "hexMin32", purpose: "déclenche POST /organizations/:id/verify-dgi (B2)" },
  { name: "COMMERCIAL_AGENT_GRANT_INTERNAL_KEY", required: false, requiredInProduction: true, format: "hexMin32", purpose: "octroi M2M du statut agent commercial terrain (B5, ADR-045)" },
  { name: "COMMISSION_BYPASS_REVIEW_INTERNAL_KEY", required: false, requiredInProduction: true, format: "hexMin32", purpose: "outil interne Squad Money — cas de contournement de commission (G3, ADR-091)" },
  { name: "DATA_RIGHTS_INTERNAL_KEY", required: false, requiredInProduction: true, format: "hexMin32", purpose: "chemin ops plateforme des droits des personnes — accès/anonymisation transverses (J2, ADR-116)" },
  { name: "APIP_WEBHOOK_SECRET", required: false, requiredInProduction: true, format: "hexMin32", purpose: "clé + secret HMAC du webhook partenaire APIP (F11, ADR-082)" },
];
