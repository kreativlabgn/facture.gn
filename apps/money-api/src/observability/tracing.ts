import { diag, DiagLogLevel, DiagConsoleLogger } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { NestInstrumentation } from "@opentelemetry/instrumentation-nestjs-core";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

import { buildTracingConfig } from "./tracing-config";
import { RedactingSpanProcessor } from "./redacting-span-processor";

// Lot H — bootstrap des traces. Appelé en TÊTE de main.ts (avant NestFactory)
// pour que les patchs d'instrumentation précèdent le chargement d'express/nest.
// Ne lève JAMAIS : un collecteur injoignable ou une config invalide se traduit
// par des traces désactivées, jamais par un crash au démarrage.

let sdk: NodeSDK | null = null;

export function startTracing(serviceName: string): NodeSDK | null {
  if (sdk) return sdk;

  const config = buildTracingConfig(process.env, serviceName);
  if (!config.enabled || !config.endpoint) return null;

  try {
    if (process.env.OTEL_LOG_LEVEL === "debug") {
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
    }

    const exporter = new OTLPTraceExporter({ url: config.endpoint, headers: config.headers });
    const processor = new RedactingSpanProcessor(new BatchSpanProcessor(exporter));

    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: config.serviceName,
        [ATTR_SERVICE_VERSION]: config.serviceVersion,
      }),
      sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.samplerRatio) }),
      spanProcessors: [processor],
      instrumentations: [
        // ignore les endpoints d'observabilité — bruit pur, et /metrics est
        // scrapé en boucle.
        new HttpInstrumentation({
          ignoreIncomingRequestHook: (req) => {
            const url = req.url ?? "";
            return url === "/metrics" || url === "/health" || url.startsWith("/health/");
          },
        }),
        new ExpressInstrumentation(),
        new NestInstrumentation(),
        new IORedisInstrumentation(),
        new PinoInstrumentation(),
      ],
    });

    sdk.start();
    return sdk;
  } catch (err) {
    // pino n'est pas encore disponible à ce stade (avant NestFactory) — console.
    console.error("[tracing] initialisation échouée, traces désactivées :", err);
    sdk = null;
    return null;
  }
}

// Flush + fermeture propre de l'exporter. À câbler dans le hook d'arrêt de
// l'app si un drain gracieux est mis en place ; non branché sur SIGTERM ici —
// ajouter un listener de signal empêcherait la terminaison par défaut du
// conteneur (docker stop / SIGTERM k8s) sauf à ré-émettre le signal soi-même.
// Sans ce flush, au pire quelques secondes de spans encore en tampon sont
// perdues à l'arrêt — acceptable, jamais au prix du chemin d'arrêt.
export async function stopTracing(): Promise<void> {
  if (!sdk) return;
  const current = sdk;
  sdk = null;
  try {
    await current.shutdown();
  } catch {
    // best-effort — le process s'arrête de toute façon.
  }
}
