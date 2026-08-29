import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { PrometheusModule, makeHistogramProvider } from "@willsoto/nestjs-prometheus";
import { HttpMetricsInterceptor, HTTP_DURATION_METRIC } from "./http-metrics.interceptor";
import { MetricsController } from "./metrics.controller";

@Module({
  imports: [
    PrometheusModule.register({
      // Notre contrôleur (@Public), jamais celui par défaut de la lib.
      controller: MetricsController,
      // event loop lag, mémoire, GC, handles… (prom-client default metrics).
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [
    makeHistogramProvider({
      name: HTTP_DURATION_METRIC,
      help: "Durée des requêtes HTTP en secondes, par route (pattern) et statut",
      labelNames: ["method", "route", "status_code"],
      // Buckets calés sur les SLO du DAT §12 (P95 API < 200 ms).
      buckets: [0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
    }),
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
})
export class MetricsModule {}
