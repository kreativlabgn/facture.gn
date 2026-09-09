import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { makeCounterProvider } from "@willsoto/nestjs-prometheus";

import { PdpController } from "./pdp.controller";
import { PdpApiKeyAuthGuard } from "./pdp-api-key-auth.guard";
import { PdpInvoiceService } from "./pdp-invoice.service";
import { PDP_JOB_OPTIONS, PDP_QUEUE } from "./pdp.constants";
import {
  PDP_DOCUMENTS_INGESTED_METRIC,
  PDP_DUPLICATES_METRIC,
  PDP_ENQUEUE_FAILURES_METRIC,
} from "./pdp.metrics";

// ADR-107 — passerelle PDP. Même patron qu'EtaxModule : file BullMQ déclarée
// ici, connexion Redis fournie par QueueModule (@Global). Pas de
// upsertJobScheduler — cette file n'est pas périodique, elle est alimentée par
// un ÉVÉNEMENT (le dépôt d'un document par un ERP tiers) ; rien à armer au
// démarrage, donc rien qui puisse échouer au boot.
//
// AUCUN @Processor DANS CETTE TRANCHE, ET C'EST UN CHOIX EXPLICITE. Le worker
// qui consommera ETAX_INVOICING_UNITARY — créer la facture, la certifier, puis
// la remettre au circuit e-TVA existant — est la tranche suivante. D'ici là les
// jobs s'accumulent dans Redis sans être traités : c'est le comportement
// VOULU (BullMQ conserve les jobs en attente, rien n'est perdu), mais cela veut
// dire que la passerelle ne doit pas être ouverte à un connecteur réel avant
// que ce worker n'existe. Les lignes restent en `pending` en base, et c'est
// exactement l'état depuis lequel le worker les reprendra.
//
// PdpApiKeyAuthGuard est déclaré en provider — pas en APP_GUARD : il ne doit
// s'appliquer QU'À ce contrôleur (@UseGuards local). Un garde global exigerait
// une clé PDP sur toute l'API.
@Module({
  imports: [
    BullModule.registerQueue({
      name: PDP_QUEUE,
      defaultJobOptions: { ...PDP_JOB_OPTIONS },
    }),
  ],
  controllers: [PdpController],
  providers: [
    PdpInvoiceService,
    PdpApiKeyAuthGuard,
    makeCounterProvider({
      name: PDP_DOCUMENTS_INGESTED_METRIC,
      help: "Documents acceptés par la passerelle PDP, par flux",
      labelNames: ["flow"],
    }),
    makeCounterProvider({
      name: PDP_DUPLICATES_METRIC,
      help: "Dépôts PDP reconnus comme des rejeux, par flux et par chemin de détection",
      labelNames: ["flow", "detection"],
    }),
    makeCounterProvider({
      name: PDP_ENQUEUE_FAILURES_METRIC,
      help: "Documents PDP e-invoicing acceptés mais jamais enfilés (Redis indisponible)",
    }),
  ],
  exports: [PdpInvoiceService],
})
export class PdpModule {}
