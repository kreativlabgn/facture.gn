import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Histogram } from "prom-client";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";

// Préfixe par service (trust_api_ / money_api_) : évite une collision de nom
// dans le registre prom-client global si les deux services sont chargés dans un
// même process (tests).
export const HTTP_DURATION_METRIC = "money_api_http_request_duration_seconds";

// Lot F — histogramme de latence HTTP par route (pattern) et statut. Base de
// mesure des SLO du DAT §12 (P95 API < 200 ms, orchestrateur < 180 ms).
// `route` = pattern Express (`/invoices/:id`), jamais l'URL concrète : la
// cardinalité des labels doit rester bornée.
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(@InjectMetric(HTTP_DURATION_METRIC) private readonly histogram: Histogram<string>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<{ method: string; route?: { path?: string }; url: string }>();
    const route: string = request.route?.path ?? "unmatched";

    // /metrics et /health* : bruit constant, jamais un signal de SLO.
    if (route === "/metrics" || route.startsWith("/health")) {
      return next.handle();
    }

    const start = process.hrtime.bigint();
    const record = (statusCode: number): void => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.histogram.observe({ method: request.method, route, status_code: statusCode }, seconds);
    };

    return next.handle().pipe(
      tap({
        // Succès : le statut de la réponse est posé au moment de l'émission.
        next: () => record(http.getResponse<{ statusCode: number }>().statusCode),
        // Erreur : le filtre d'exception n'a pas encore tourné — on infère depuis
        // l'exception (HttpException porte .status), 500 par défaut.
        error: (err: unknown) => {
          const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 500;
          record(status);
        },
      }),
    );
  }
}
