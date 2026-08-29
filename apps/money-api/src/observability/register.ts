// Lot H — voir apps/trust-api/src/observability/register.ts. Importé en 2e
// ligne de main.ts, avant tout module applicatif.
import { startTracing } from "./tracing";

startTracing("money-api");
