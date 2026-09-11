import { BullModule, InjectQueue } from "@nestjs/bullmq";
import { Logger, Module, type OnModuleInit } from "@nestjs/common";
import { InjectMetric, makeCounterProvider, makeGaugeProvider } from "@willsoto/nestjs-prometheus";
import type { Queue } from "bullmq";
import type { Gauge } from "prom-client";

import { InvoicesModule } from "../invoices/invoices.module";
import { PdpConsolidationService } from "./pdp-consolidation.service";
import { PdpController } from "./pdp.controller";
import { PdpApiKeyAuthGuard } from "./pdp-api-key-auth.guard";
import { PdpInvoiceService } from "./pdp-invoice.service";
import { PdpReportingNumberingService } from "./pdp-reporting-numbering.service";
import {
  ETAX_REPORTING_CONSOLIDATION_CRON,
  PDP_JOB_OPTIONS,
  PDP_QUEUE,
  PDP_REPORTING_INTERVAL_MS,
  PDP_REPORTING_SCHEDULER_ID,
  pdpReportingEnabled,
} from "./pdp.constants";
import { PdpProcessor } from "./pdp.processor";
import {
  PDP_CONSOLIDATED_METRIC,
  PDP_CONSOLIDATION_FAILURES_METRIC,
  PDP_DOCUMENTS_INGESTED_METRIC,
  PDP_DUPLICATES_METRIC,
  PDP_ENQUEUE_FAILURES_METRIC,
  PDP_REPORTING_BATCHES_METRIC,
  PDP_REPORTING_SCHEDULER_ARMED_METRIC,
  PDP_REPORTING_TICKETS_METRIC,
} from "./pdp.metrics";

// ADR-107 — passerelle PDP. Même patron qu'EtaxModule : file BullMQ déclarée
// ici, connexion Redis fournie par QueueModule (@Global).
//
// LA FILE EST DÉSORMAIS MIXTE (tranche 3), et c'est le seul point de ce module
// qui demande une lecture attentive. Elle porte deux régimes sur le même nom :
//   • ÉVÉNEMENTIEL — le dépôt d'un document par un ERP tiers enfile
//     ETAX_INVOICING_UNITARY, comme depuis la tranche 1 ;
//   • PÉRIODIQUE — un job scheduler armé ci-dessous (upsertJobScheduler, même
//     patron que MerkleAnchorModule / E1) pose ETAX_REPORTING_CONSOLIDATION_CRON
//     toutes les heures, qui à son tour déploie un ETAX_REPORTING_PERIODIC par
//     organisation.
// Une seule file pour les deux : PdpProcessor aiguille déjà sur job.name, et
// séparer les régimes coûterait un second worker pour un travail dont le profil
// de charge est le même (des lots, jamais des pics unitaires).
//
// LE @Processor EXISTE DÉSORMAIS (tranche 2). PdpProcessor consomme la file et
// aiguille sur job.name : ETAX_INVOICING_UNITARY part en consolidation unitaire,
// ETAX_REPORTING_CONSOLIDATION_CRON déploie l'éventail, ETAX_REPORTING_PERIODIC
// compile le Z de caisse d'une organisation. Le déclarer en `providers` ne suffit
// pas à le faire tourner par accident : c'est le décorateur @Processor qui
// connecte NestJS à Redis, et c'est bien l'instanciation par ce module qui l'arme
// au démarrage.
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
    PdpReportingNumberingService,
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
    makeCounterProvider({
      name: PDP_REPORTING_BATCHES_METRIC,
      help: "Z de caisse e-Reporting certifiés et remis au circuit e-TVA",
    }),
    makeCounterProvider({
      name: PDP_REPORTING_TICKETS_METRIC,
      help: "Micro-ventes de caisse consolidées dans un Z de caisse",
    }),
    makeGaugeProvider({
      name: PDP_REPORTING_SCHEDULER_ARMED_METRIC,
      help: "1 si le cron de regroupement e-Reporting est armé",
    }),
  ],
  exports: [PdpInvoiceService],
})
export class PdpModule implements OnModuleInit {
  private readonly logger = new Logger(PdpModule.name);

  constructor(
    @InjectQueue(PDP_QUEUE) private readonly queue: Queue,
    @InjectMetric(PDP_REPORTING_SCHEDULER_ARMED_METRIC) private readonly armed: Gauge<string>,
  ) {}

  // Armement du cron de regroupement. Même patron que MerkleAnchorModule (E1) et
  // que la rétention (J3) : opt-in explicite, JAMAIS bloquant au démarrage.
  //
  // ── POURQUOI UN OPT-IN, ALORS QUE LE RESTE DE LA PASSERELLE TOURNE TOUJOURS ─
  // Ce cron ÉMET des factures certifiées et consomme des numéros Article 23,
  // irréversiblement. Il ne doit pas se mettre à tourner du seul fait qu'un
  // environnement a été déployé — une base de recette restaurée depuis la
  // production produirait sinon, dans l'heure, un lot de Z de caisse sur des
  // ventes déjà déclarées.
  //
  // La jauge est posée à 0 AVANT toute tentative, et remise à 1 seulement si
  // l'armement a réellement abouti : c'est le seul signal qui distingue « pas de
  // Z parce qu'il n'y a pas de ventes » de « pas de Z parce que rien ne tourne ».
  // Sans elle, des tickets s'accumuleraient en silence dans la table tampon et le
  // manquement déclaratif ne se découvrirait qu'au contrôle.
  async onModuleInit(): Promise<void> {
    this.armed.set(0);

    if (!pdpReportingEnabled()) {
      this.logger.warn(
        'Regroupement e-Reporting désactivé (PDP_REPORTING_ENABLED != "true") — les micro-ventes B2C restent en attente dans la table tampon.',
      );
      return;
    }

    try {
      await this.queue.upsertJobScheduler(
        PDP_REPORTING_SCHEDULER_ID,
        { every: PDP_REPORTING_INTERVAL_MS },
        { name: ETAX_REPORTING_CONSOLIDATION_CRON },
      );
      this.armed.set(1);
      this.logger.log(
        `Regroupement e-Reporting actif (éventail toutes les ${PDP_REPORTING_INTERVAL_MS / 60_000} min)`,
      );
    } catch (error) {
      // trust-api DÉMARRE QUAND MÊME. Un Redis absent au boot ne doit pas empêcher
      // l'API d'accepter des dépôts : les tickets s'accumuleront en `pending` et
      // seront compilés dès qu'un démarrage réussira à armer le scheduler. Faire
      // échouer le boot transformerait une panne de broker en indisponibilité
      // totale de la passerelle.
      const err = error instanceof Error ? error : new Error(String(error));
      const code = (err as { code?: string }).code;
      this.logger.error(
        `Échec de l'armement du cron e-Reporting${code ? ` [${code}]` : ""} — trust-api démarre quand même, aucun Z de caisse ne sera compilé`,
        err.stack ?? err.message,
      );
    }
  }
}
