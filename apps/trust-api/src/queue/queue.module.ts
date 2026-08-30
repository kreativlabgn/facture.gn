import { Global, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";

import { buildRedisConnection } from "./queue.config";

// Lot J3 — brique BullMQ transverse de trust-api (copie du pattern money-api,
// Lot E). @Global : les modules qui déclarent une file (BullModule.registerQueue)
// n'ont pas à réimporter la connexion. Première file réelle : retention.
@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: buildRedisConnection(),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
