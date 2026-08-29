import { Module } from "@nestjs/common";
import { TerminusModule, PrismaHealthIndicator } from "@nestjs/terminus";
import { BullModule } from "@nestjs/bullmq";
import { RECONCILIATION_QUEUE } from "../reconciliation/reconciliation.processor";
import { HealthController } from "./health.controller";
import { RedisHealthIndicator } from "./redis-health.indicator";

@Module({
  // registerQueue : accès à la connexion ioredis existante (RedisHealthIndicator),
  // jamais une seconde file/connexion.
  imports: [TerminusModule, BullModule.registerQueue({ name: RECONCILIATION_QUEUE })],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
