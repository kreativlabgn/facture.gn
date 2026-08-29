import { Logger, Module, type OnModuleInit } from "@nestjs/common";
import { BullModule, InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PaymentConfirmationClient } from "../webhooks/payment-confirmation-client";
import { ReconciliationService } from "./reconciliation.service";
import { RECONCILIATION_QUEUE, ReconciliationProcessor } from "./reconciliation.processor";

const REPEAT_EVERY_MS = 5 * 60 * 1000;
const SCHEDULER_ID = "reconciliation-every-5m";

// Lot E — première file BullMQ réelle. PaymentConfirmationClient (sans état, lit
// l'env) est re-fourni ici plutôt qu'exporté par WebhooksModule (qui porte un
// contrôleur) — même instance logique, aucun couplage.
@Module({
  imports: [BullModule.registerQueue({ name: RECONCILIATION_QUEUE })],
  providers: [ReconciliationService, ReconciliationProcessor, PaymentConfirmationClient],
})
export class ReconciliationModule implements OnModuleInit {
  private readonly logger = new Logger(ReconciliationModule.name);

  constructor(@InjectQueue(RECONCILIATION_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    // RECONCILIATION_ENABLED=false : garder la brique BullMQ sans lancer le
    // worker (déploiement progressif, ou environnement de test/CI).
    if (process.env.RECONCILIATION_ENABLED === "false") {
      this.logger.warn("Worker de réconciliation désactivé (RECONCILIATION_ENABLED=false)");
      return;
    }
    // upsert : jobId de scheduler stable → un seul job répétable quel que soit
    // le nombre de redémarrages / d'instances. Un échec (Redis indisponible au
    // démarrage) ne doit JAMAIS empêcher money-api de démarrer — la
    // réconciliation est un COMPLÉMENT du webhook, jamais le chemin nominal
    // d'encaissement. Le scheduler sera réarmé au prochain redémarrage.
    try {
      await this.queue.upsertJobScheduler(SCHEDULER_ID, { every: REPEAT_EVERY_MS }, { name: "run" });
      this.logger.log(`Worker de réconciliation actif (toutes les ${REPEAT_EVERY_MS / 60000} min)`);
    } catch (error) {
      this.logger.error(
        `Échec de l'armement du worker de réconciliation (Redis ?) — money-api démarre quand même : ${(error as Error).message}`,
      );
    }
  }
}
