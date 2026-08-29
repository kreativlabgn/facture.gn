// Lot H — point d'entrée à effet de bord, importé en 2e ligne de main.ts (juste
// après reflect-metadata, AVANT tout module applicatif). Démarre les traces
// OpenTelemetry si elles sont activées, pour que l'instrumentation patche
// http / express / nest avant leur premier chargement.
import { startTracing } from "./tracing";

startTracing("trust-api");
