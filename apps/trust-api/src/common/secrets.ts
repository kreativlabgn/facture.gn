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
  { name: "DATA_RIGHTS_SUBJECT_HASH_PEPPER", required: false, requiredInProduction: true, format: "hexMin32", purpose: "pepper HMAC du subject_phone_hash du registre data_rights_request — sans lui le hash d'un MSISDN est réversible (J2, ADR-116)" },
  { name: "APIP_WEBHOOK_SECRET", required: false, requiredInProduction: true, format: "hexMin32", purpose: "clé + secret HMAC du webhook partenaire APIP (F11, ADR-082)" },
  { name: "CREDITS_INTERNAL_KEY", required: false, requiredInProduction: true, format: "hexMin32", purpose: "console d'administration — rechargement des portefeuilles de crédits (crée de la valeur monétaire, secret strictement dédié)" },
  { name: "ETAX_API_KEY", required: false, requiredInProduction: true, format: "hexMin32", purpose: "secret HMAC de signature des déclarations de TVA transmises à eTax (chantier 5, étape 3)" },
  { name: "WHATSAPP_APP_SECRET", required: false, requiredInProduction: true, format: "hexMin32", purpose: "secret HMAC-SHA256 du webhook WhatsApp entrant (WhatsAppWebhookAuthGuard, plan 2026-09-16, OCR multicanal)" },
  { name: "WHATSAPP_WEBHOOK_VERIFY_TOKEN", required: false, requiredInProduction: true, format: "any", purpose: "jeton de handshake GET /webhooks/whatsapp (hub.verify_token), provisionné dans le tableau de bord Meta" },
  // Lot suivant, ajouté ici (secrets.ts est l'inventaire unique, cf. commentaire
  // de TRUST_API_SECRETS) — oubli constaté lors du plan 2026-09-16 (OCR
  // multicanal) : trust-api dépend de Redis (BullMQ : retention, merkle-anchor,
  // pdp, ocr-pipeline) depuis plusieurs lots déjà livrés, sans que REDIS_URL ne
  // figure jamais dans cet inventaire. Fallback localhost:6379 toléré en dev
  // (voir .env.example), jamais en production.
  { name: "REDIS_URL", required: false, requiredInProduction: true, format: "redisUrl", purpose: "connexion Redis partagée par les files BullMQ de trust-api (retention, merkle-anchor, pdp, ocr-pipeline) — fallback localhost:6379 toléré en dev, jamais en production" },
  // Plan 2026-09-16 (OCR multicanal) — Hub STT auto-hébergé (clarification 2b :
  // jamais un SaaS tiers, une note vocale contient un nom de client et un
  // montant). Même discipline que OCR_VISION_ENDPOINT/OCR_VISION_TOKEN
  // ci-dessous : "httpUrl"/"hexMin32" ne sont PAS `required` ici (endpoint
  // absent = mode non configuré, 503 explicite sur le job de transcription,
  // jamais un refus de démarrage) — voir sovereign-stt.provider.ts.
  { name: "OCR_STT_ENDPOINT", required: false, requiredInProduction: false, format: "httpUrl", purpose: "point de transcription du Hub STT souverain (auto-hébergé) — absent = branche vocale non configurée, 503 explicite sur le job (plan 2026-09-16)" },
  { name: "OCR_STT_TOKEN", required: false, requiredInProduction: false, format: "hexMin32", purpose: "jeton Bearer du Hub STT souverain — OCR_STT_ENDPOINT défini sans lui refuse de démarrer (sovereign-stt.provider.ts)" },
  // Plan 2026-09-16, étape 2 (WHATSAPP_TEXT) — connecteur SORTANT de l'API
  // Graph Meta (envoi de message + relais média étape 3). "any" : ce sont des
  // identifiants Meta, pas des secrets générés par facture.gn (aucun format
  // hexadécimal à imposer). requiredInProduction: false, DÉLIBÉRÉMENT — les
  // deux commentaires d'usine (sovereign-whatsapp-send.provider.ts,
  // whatsapp-media-relay.service.ts) sont explicites : absents, on retombe sur
  // WhatsAppStubProvider (envoi) et UnconfiguredWhatsAppMediaRelay (relais
  // média), JAMAIS un refus de démarrage. Poser `requiredInProduction: true`
  // ici contredirait cette conception et bloquerait TOUT trust-api en
  // production (facturation, certification, USSD...) tant que Meta n'est pas
  // contractualisé — contrairement à WHATSAPP_APP_SECRET/
  // WHATSAPP_WEBHOOK_VERIFY_TOKEN ci-dessus, qui protègent une vraie
  // frontière de confiance (signature du webhook) et fail-fast à dessein.
  { name: "WHATSAPP_ACCESS_TOKEN", required: false, requiredInProduction: false, format: "any", purpose: "jeton Bearer de l'API Graph Meta — envoi de message sortant (SovereignWhatsAppSendProvider) et relais du média vocal entrant (whatsapp-media-relay.service.ts, plan 2026-09-16) ; absent = repli best-effort, jamais un refus de démarrage" },
  { name: "WHATSAPP_PHONE_NUMBER_ID", required: false, requiredInProduction: false, format: "any", purpose: "identifiant du numéro WhatsApp plateforme — cible de POST /{id}/messages (SovereignWhatsAppSendProvider) ; absent = repli best-effort (WhatsAppStubProvider), jamais un refus de démarrage" },
  // Étape 3 du plan 2026-09-16 (WHATSAPP_VOICE) — stockage objet MinIO
  // auto-hébergé (DAT/ADR-013, tranché par le fondateur), première capacité
  // d'ÉCRITURE de trust-api dans un stockage objet (whatsapp-media-relay.service.ts).
  // "any" pour les identifiants MinIO (pas de format facture.gn imposé — ce
  // sont des credentials fournis par l'exploitation MinIO). requiredInProduction:
  // false, délibérément — voir le commentaire de UnconfiguredWhatsAppMediaRelay :
  // absent, seule la branche audio du guichet WhatsApp échoue prédictiblement,
  // jamais tout trust-api au démarrage (contrairement à DATABASE_URL/JWT_*).
  { name: "STORAGE_ENDPOINT", required: false, requiredInProduction: false, format: "httpUrl", purpose: "point de terminaison compatible S3 du stockage objet MinIO auto-hébergé (DAT/ADR-013) — absent, la branche audio du guichet WhatsApp échoue prédictiblement (WhatsAppMediaRelayIndisponible)" },
  { name: "STORAGE_ACCESS_KEY", required: false, requiredInProduction: false, format: "any", purpose: "identifiant d'accès MinIO du bucket STORAGE_BUCKET" },
  { name: "STORAGE_SECRET_KEY", required: false, requiredInProduction: false, format: "any", purpose: "secret d'accès MinIO du bucket STORAGE_BUCKET" },
  { name: "STORAGE_BUCKET", required: false, requiredInProduction: false, format: "any", purpose: "bucket MinIO dédié au relais média WhatsApp (ex. ocr-media, plan 2026-09-16)" },
];

// Choix délibéré : OCR_VISION_ENDPOINT/OCR_VISION_TOKEN (ADR-122) ne sont PAS
// ajoutées ici. Elles prédatent ce lot, sont déjà absentes de cet inventaire
// aujourd'hui, et leur ajout n'est pas nécessaire pour l'étape 3 du plan
// 2026-09-16 (relais média WhatsApp) — l'élargir ici aurait mélangé un
// correctif hors mandat dans ce diff. Si ADR-122 doit un jour fail-fast au
// même titre que WHATSAPP_APP_SECRET, ce sera une décision à part, pour la
// même raison que REDIS_URL ci-dessus a été traité comme un oubli séparé et
// non comme un prétexte pour auditer tout l'inventaire.
