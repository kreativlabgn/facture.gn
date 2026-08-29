import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

// Lot H — la redaction pino (Vague 0) agit sur les logs ; les attributs de span
// sont un second canal de fuite (db.statement, query string d'une URL, en-tête
// Authorization capturé par l'instrumentation HTTP). Ce processor nettoie chaque
// span AVANT de le passer au processor réel (BatchSpanProcessor → exporter OTLP).

const REDACTED = "[redacted]";

// Clés d'attribut supprimées intégralement (comparaison insensible à la casse
// sur une sous-chaîne — couvre http.request.header.authorization,
// db.statement, messaging.message.body, etc.).
const SENSITIVE_KEY_SUBSTRINGS = [
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
  "api_key",
  "apikey",
  "signature",
  "pin",
  "nif",
  "db.statement",
  "db.query.text",
  "private_key",
  "privatekey",
];

// Attributs d'URL portant un chemin + une query : on garde le chemin, on jette
// la query string (peut porter un token de lien de paiement, un code OTP…).
const URL_WITH_PATH_KEYS = ["http.url", "http.target", "url.full", "url.path"];
// `url.query` (convention sémantique : la query SANS le "?") est toujours
// entièrement sensible — jamais de heuristique sur "?".
const QUERY_ONLY_KEYS = ["url.query"];

function stripQueryString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const q = value.indexOf("?");
  return q === -1 ? value : `${value.slice(0, q)}?${REDACTED}`;
}

// Mutation en place de l'objet d'attributs du span (même référence que celle que
// le BatchSpanProcessor lira ensuite dans onEnd).
export function redactSpanAttributes(attributes: Record<string, unknown>): void {
  for (const key of Object.keys(attributes)) {
    const lowered = key.toLowerCase();
    if (QUERY_ONLY_KEYS.includes(lowered)) {
      attributes[key] = REDACTED;
      continue;
    }
    if (URL_WITH_PATH_KEYS.includes(lowered)) {
      attributes[key] = stripQueryString(attributes[key]);
      continue;
    }
    if (SENSITIVE_KEY_SUBSTRINGS.some((s) => lowered.includes(s))) {
      attributes[key] = REDACTED;
    }
  }
}

export class RedactingSpanProcessor implements SpanProcessor {
  constructor(private readonly inner: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    const attributes = span.attributes as Record<string, unknown>;
    try {
      redactSpanAttributes(attributes);
    } catch {
      // En dernier recours, on vide plutôt que de risquer d'exporter en clair.
      for (const key of Object.keys(attributes)) attributes[key] = REDACTED;
    }
    this.inner.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}
