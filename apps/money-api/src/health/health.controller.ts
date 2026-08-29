import { Controller, Get, Inject } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from "@nestjs/terminus";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { Public } from "../common/public.decorator";
import { RedisHealthIndicator } from "./redis-health.indicator";

// Lot F — voir apps/trust-api/src/health/health.controller.ts. money-api ajoute
// Redis (BullMQ, worker de réconciliation) aux dépendances dures.
@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    @Inject(PRISMA_CLIENT) private readonly prismaClient?: PrismaClient,
  ) {}

  @Get("live")
  @Public()
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @Public()
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prisma.pingCheck("database", this.prismaClient as PrismaClient),
      () => this.redis.isHealthy("redis"),
    ]);
  }
}
