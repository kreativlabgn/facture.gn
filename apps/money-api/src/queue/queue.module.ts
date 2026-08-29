import { Global, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { buildRedisConnection } from "./queue.config";

// Lot E — brique BullMQ transverse. @Global : les modules qui déclarent une file
// (BullModule.registerQueue) n'ont pas à réimporter la connexion. Première file
// réelle : reconciliation (voir ReconciliationModule).
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
