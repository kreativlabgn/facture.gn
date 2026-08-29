import { Controller, Get, Header } from "@nestjs/common";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { register } from "prom-client";
import { Public } from "../common/public.decorator";

// Lot F — exposition Prometheus. Contrôleur explicite (pas celui par défaut de
// @willsoto/nestjs-prometheus) uniquement pour porter @Public() : sinon
// JwtAuthGuard le bloque (même raison que /docs, Vague 0). À NE PAS exposer via
// l'ingress public — scrape interne au cluster uniquement.
@Controller("metrics")
export class MetricsController {
  @Get()
  @Public()
  @ApiExcludeEndpoint()
  @Header("Content-Type", register.contentType)
  async scrape(): Promise<string> {
    return register.metrics();
  }
}
