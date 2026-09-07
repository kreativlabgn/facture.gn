import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { makeCounterProvider } from "@willsoto/nestjs-prometheus";

import { EtaxClient } from "./etax.client";
import { ETAX_JOB_OPTIONS, ETAX_QUEUE } from "./etax.constants";
import {
  ETAX_ENQUEUE_FAILURES_METRIC,
  ETAX_FAILURES_METRIC,
  ETAX_SUBMITTED_METRIC,
} from "./etax.metrics";
import { EtaxSyncProcessor } from "./etax-sync.processor";
import { EtaxSyncService } from "./etax-sync.service";

// Chantier 5, étape 3 — même patron que RetentionModule (Lot J3) : file BullMQ
// déclarée ici, connexion Redis fournie par QueueModule (@Global).
//
// PAS DE upsertJobScheduler, contrairement à la rétention : cette file n'est pas
// périodique. Elle est alimentée par un ÉVÉNEMENT — la clôture d'un exercice —
// donc rien à armer au démarrage, et rien qui puisse échouer au boot.
//
// defaultJobOptions porte le profil d'échec : il s'applique aussi aux jobs
// ajoutés sans options explicites (rattrapage manuel, outil d'exploitation), ce
// qui évite qu'un job enfilé par un autre chemin perde le backoff.
@Module({
  imports: [
    BullModule.registerQueue({
      name: ETAX_QUEUE,
      defaultJobOptions: { ...ETAX_JOB_OPTIONS },
    }),
  ],
  providers: [
    EtaxSyncService,
    EtaxSyncProcessor,
    EtaxClient,
    makeCounterProvider({
      name: ETAX_SUBMITTED_METRIC,
      help: "Nombre de déclarations de TVA acquittées par eTax",
    }),
    makeCounterProvider({
      name: ETAX_FAILURES_METRIC,
      help: "Nombre d'échecs de télétransmission eTax, par cause",
      labelNames: ["reason"],
    }),
    makeCounterProvider({
      name: ETAX_ENQUEUE_FAILURES_METRIC,
      help: "Nombre de clôtures qui n'ont pas pu être enfilées (Redis indisponible)",
    }),
  ],
  // FiscalPeriodsModule injecte EtaxSyncService pour enfiler à la clôture.
  exports: [EtaxSyncService],
})
export class EtaxModule {}
