// Lot H — configuration des traces OpenTelemetry (fonction PURE, testable sans
// SDK). Les traces sont OPT-IN : il faut OTEL_TRACES_ENABLED=true ET un endpoint
// OTLP. Sans les deux, `enabled` est faux et `startTracing` ne patche rien.

export interface TracingConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  /** URL complète de l'endpoint OTLP/HTTP pour les traces (…/v1/traces). */
  endpoint?: string;
  headers?: Record<string, string>;
  /** Ratio de sampling racine, borné à [0, 1]. */
  samplerRatio: number;
}

// "key1=value1,key2=value2" → { key1: "value1", key2: "value2" }
// Format OTEL_EXPORTER_OTLP_HEADERS (spec OpenTelemetry). Une entrée sans "="
// est ignorée plutôt que de produire une clé vide.
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key) headers[key] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

// Endpoint : la variable spécifique aux traces prime ; sinon on dérive le path
// /v1/traces de l'endpoint générique (convention OTLP/HTTP).
function resolveEndpoint(env: NodeJS.ProcessEnv): string | undefined {
  const specific = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (specific) return specific;
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/v1/traces`;
}

function resolveSamplerRatio(raw: string | undefined): number {
  const parsed = Number(raw ?? "1");
  if (Number.isNaN(parsed)) return 1;
  return Math.min(1, Math.max(0, parsed));
}

export function buildTracingConfig(env: NodeJS.ProcessEnv, serviceName: string): TracingConfig {
  const endpoint = resolveEndpoint(env);
  const enabled = env.OTEL_TRACES_ENABLED === "true" && endpoint !== undefined;
  return {
    enabled,
    serviceName: env.OTEL_SERVICE_NAME?.trim() || serviceName,
    serviceVersion: env.OTEL_SERVICE_VERSION?.trim() || "0.0.0",
    endpoint,
    headers: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    samplerRatio: resolveSamplerRatio(env.OTEL_TRACES_SAMPLER_ARG),
  };
}
