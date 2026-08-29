import { Controller, Get, Inject } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { ApiTags } from "@nestjs/swagger";
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from "@nestjs/terminus";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { Public } from "../auth/public.decorator";

// Lot F — endpoints d'exploitation. @Public() : jamais derrière JwtAuthGuard
// (k8s et Prometheus n'ont pas de JWT). À ne PAS exposer via l'ingress public
// (voir README §Observabilité).
@ApiTags("health")
@Controller("health")
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaHealthIndicator,
    @Inject(PRISMA_CLIENT) private readonly prismaClient?: PrismaClient,
  ) {}

  // livenessProbe : le process répond. AUCUN I/O — ne jamais redémarrer un pod
  // parce que Postgres est lent.
  @Get("live")
  @Public()
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  // readinessProbe : les dépendances dures répondent. 503 sinon → le pod est
  // retiré du service sans être tué.
  @Get("ready")
  @Public()
  @HealthCheck()
  ready() {
    return this.health.check([() => this.prisma.pingCheck("database", this.prismaClient as PrismaClient)]);
  }
}
