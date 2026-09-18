import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { OCR_PIPELINE_QUEUE } from "../ai/ocr-pipeline.constants";
import { ETAX_QUEUE } from "../etax/etax.constants";
import { PDP_QUEUE } from "../pdp/pdp.constants";
import { RETENTION_QUEUE } from "../retention/retention.processor";
import { MERKLE_FLUSH_QUEUE, MERKLE_SEAL_QUEUE } from "../certification/merkle-anchor/merkle-anchor.processor";
import { InfrastructureController } from "./infrastructure.controller";
import { InfrastructureService } from "./infrastructure.service";

// Chantier 2026-09-18 (console infrastructure) — lecture seule des 6 files déjà
// possédées par leurs modules respectifs (ai, etax, pdp, retention,
// merkle-anchor). registerQueue() par nom est idempotent côté BullMQ/NestJS :
// c'est le même pattern que toute autre file référencée depuis plusieurs
// modules dans ce dépôt (voir le nombre de "BullModule dependencies
// initialized" au boot) — aucune queue supplémentaire n'est créée dans Redis,
// seul le provider @InjectQueue local à ce module l'est.
@Module({
  imports: [
    BullModule.registerQueue(
      { name: OCR_PIPELINE_QUEUE },
      { name: ETAX_QUEUE },
      { name: PDP_QUEUE },
      { name: RETENTION_QUEUE },
      { name: MERKLE_SEAL_QUEUE },
      { name: MERKLE_FLUSH_QUEUE },
    ),
  ],
  controllers: [InfrastructureController],
  providers: [InfrastructureService],
})
export class InfrastructureModule {}
