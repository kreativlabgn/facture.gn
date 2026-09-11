import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { makeCounterProvider } from "@willsoto/nestjs-prometheus";

import { InvoicesModule } from "../invoices/invoices.module";
import { PdpConsolidationService } from "./pdp-consolidation.service";
import { PdpController } from "./pdp.controller";
import { PdpApiKeyAuthGuard } from "./pdp-api-key-auth.guard";
import { PdpInvoiceService } from "./pdp-invoice.service";
import { PDP_JOB_OPTIONS, PDP_QUEUE } from "./pdp.constants";
import { PdpProcessor } from "./pdp.processor";
import {
  PDP_CONSOLIDATED_METRIC,
  PDP_CONSOLIDATION_FAILURES_METRIC,
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
// LE @Processor EXISTE DÉSORMAIS (tranche 2). PdpProcessor consomme la file et
// aiguille sur job.name : ETAX_INVOICING_UNITARY part en consolidation (créer la
// facture, la certifier, la remettre au circuit e-TVA existant),
// ETAX_REPORTING_PERIODIC laisse ses lignes en `pending` pour le cron de
// regroupement. Le déclarer en `providers` ne suffit pas à le faire tourner par
// accident : c'est le décorateur @Processor qui connecte NestJS à Redis, et
// c'est bien l'instanciation par ce module qui l'arme au démarrage.
//
// InvoicesModule est importé pour InvoicesService : la consolidation passe par
// issue() et par rien d'autre — numérotation Article 23, certification Ed25519,
// chaînage, enfilement e-TVA. Aucun cycle : InvoicesModule ne connaît pas la
// passerelle PDP (il importe RenderingModule et EtaxModule, aucun des deux ne
// remonte ici).
//
// PdpApiKeyAuthGuard est déclaré en provider — pas en APP_GUARD : il ne doit
// s'appliquer QU'À ce contrôleur (@UseGuards local). Un garde global exigerait
// une clé PDP sur toute l'API.
@Module({
  imports: [
    InvoicesModule,
    BullModule.registerQueue({
      name: PDP_QUEUE,
      defaultJobOptions: { ...PDP_JOB_OPTIONS },
    }),
  ],
  controllers: [PdpController],
  providers: [
    PdpInvoiceService,
    PdpConsolidationService,
    PdpProcessor,
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
    makeCounterProvider({
      name: PDP_CONSOLIDATED_METRIC,
      help: "Documents PDP e-invoicing consolidés en facture certifiée par le worker",
    }),
    makeCounterProvider({
      name: PDP_CONSOLIDATION_FAILURES_METRIC,
      help: "Consolidations PDP abandonnées définitivement, par cause",
      labelNames: ["reason"],
    }),
  ],
  exports: [PdpInvoiceService],
})
export class PdpModule {}
