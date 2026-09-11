import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Queue } from "bullmq";
import type { Counter } from "prom-client";
import type { PdpFlow, PdpTransactionStatus, Prisma, PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { buildVerificationQrDataUrl, verificationUrl } from "../rendering/verification-qr";
import type { CreatePdpInvoiceDto, PdpTransactionType } from "./dto/create-pdp-invoice.dto";
import type { PdpClientContext } from "./pdp-client.decorator";
import { buildPdpJobId, ETAX_INVOICING_UNITARY, PDP_JOB_OPTIONS, PDP_QUEUE } from "./pdp.constants";
import {
  PDP_DOCUMENTS_INGESTED_METRIC,
  PDP_DUPLICATES_METRIC,
  PDP_ENQUEUE_FAILURES_METRIC,
} from "./pdp.metrics";

/** Le reçu fiscal, rendu tel quel au connecteur ERP dès que le document est
 *  certifié. `qrCode` est un PNG en data URI, prêt à être imprimé sur le ticket
 *  ou la facture produits par l'ERP — c'est la même image que celle du PDF
 *  facture.gn, construite depuis le même certificationId. */
export interface PdpReceipt {
  certificationId: string;
  invoiceId: string | null;
  verificationUrl: string;
  qrCode: string;
}

export interface PdpIngestionResult {
  /** "accepted" = document nouveau, pris en charge. "duplicate" = ce
   *  clientUniqueId avait déjà été déposé, rien n'a été créé une seconde fois. */
  outcome: "accepted" | "duplicate";
  transactionId: string;
  clientUniqueId: string;
  flow: PdpFlow;
  status: PdpTransactionStatus;
  /** Non nul UNIQUEMENT quand le document est certifié. */
  receipt: PdpReceipt | null;
}

/** Charge utile du job e-invoicing — délibérément MINIMALE. Le worker relira la
 *  ligne tampon en base : c'est elle la source de vérité, le job n'est qu'un
 *  déclencheur (même discipline qu'EtaxSyncService.processDeclaration, dont le
 *  payload est reconstruit depuis la clôture et jamais recopié du job). Un
 *  payload gras se serait périmé au premier rejeu. */
export interface PdpInvoicingJobPayload {
  rawTransactionId: string;
  organizationId: string;
  clientUniqueId: string;
}

/** b2b/b2g → facture unitaire certifiée. b2c → ligne agrégée en Z de caisse. */
export function flowForTransactionType(type: PdpTransactionType): PdpFlow {
  return type === "b2c" ? "e_reporting" : "e_invoicing";
}

// Ce que la lecture d'idempotence et l'insertion ont en commun — évite de
// dépendre du type Prisma complet dans les helpers privés, qui n'ont besoin que
// de ces champs (et rend les tests unitaires lisibles).
type LigneTampon = {
  id: string;
  clientUniqueId: string;
  flow: PdpFlow;
  status: PdpTransactionStatus;
  organizationId: string;
  invoiceId: string | null;
  certificationId: string | null;
};

// ADR-107 — cœur de la passerelle PDP.
//
// RLS (ADR-111) — CARTE DU MODULE. TOUT est scopé, sans exception : contrairement
// au garde qui le précède, ce service ne découvre jamais rien. L'organisation
// est connue avant qu'il ne soit appelé — elle vient de la clé API vérifiée, et
// d'aucune autre source (le payload n'a pas de champ organizationId, voir
// create-pdp-invoice.dto.ts). C'est ce qui rend l'étanchéité tenable ici : un
// connecteur Odoo authentifié pour la PME A ne peut pas nommer la PME B, même
// en le demandant explicitement.
@Injectable()
export class PdpInvoiceService {
  private readonly logger = new Logger(PdpInvoiceService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @InjectQueue(PDP_QUEUE) private readonly queue: Queue,
    @InjectMetric(PDP_DOCUMENTS_INGESTED_METRIC) private readonly ingested: Counter<string>,
    @InjectMetric(PDP_DUPLICATES_METRIC) private readonly duplicates: Counter<string>,
    @InjectMetric(PDP_ENQUEUE_FAILURES_METRIC) private readonly enqueueFailures: Counter<string>,
  ) {}

  /**
   * Dépôt d'un document par un connecteur ERP.
   *
   * `payloadBrut` est le corps JSON EXACTEMENT tel que reçu, avant validation :
   * c'est lui qui est archivé, jamais le DTO reconstruit. La nuance compte le
   * jour où un client conteste ce que son ERP a envoyé — un DTO normalisé ne
   * prouverait que ce que nous en avons compris.
   */
  async ingest(
    dto: CreatePdpInvoiceDto,
    client: PdpClientContext,
    payloadBrut: Prisma.InputJsonValue,
  ): Promise<PdpIngestionResult> {
    const scoped = organizationScopedClient(this.prisma, client.organizationId);
    const flow = flowForTransactionType(dto.transactionType);

    // ── 1. Idempotence, chemin nominal ────────────────────────────────────────
    // Un rejeu de connecteur est la situation NORMALE, pas l'exception : un
    // timeout réseau côté Odoo suffit à le déclencher, et il rejouera tout son
    // lot. Cette lecture évite de faire échouer une insertion pour l'immense
    // majorité de ces cas. Elle ne SUFFIT pas — voir la collision plus bas.
    // findFirst et double clause, jamais findUnique via un client scopé.
    const existante = await scoped.pdpRawTransaction.findFirst({
      where: { organizationId: client.organizationId, clientUniqueId: dto.clientUniqueId },
    });
    if (existante) {
      return this.surRejeu(existante, "lecture");
    }

    // ── 2. Insertion ──────────────────────────────────────────────────────────
    let ligne: LigneTampon;
    try {
      ligne = await scoped.pdpRawTransaction.create({
        data: {
          organizationId: client.organizationId,
          apiKeyId: client.apiKeyId,
          clientUniqueId: dto.clientUniqueId,
          flow,
          // `pending` explicite, alors que la colonne le porte en défaut : cette
          // ligne est la seule trace de ce que le connecteur a déposé tant que
          // rien ne l'a traitée, et un lecteur du code doit voir l'état initial
          // sans avoir à ouvrir le schéma.
          status: "pending",
          totalHtCentimes: dto.totalHT,
          totalVatCentimes: dto.totalVAT,
          // TTC dérivé, jamais reçu — voir create-pdp-invoice.dto.ts.
          totalTtcCentimes: dto.totalHT + dto.totalVAT,
          payload: payloadBrut,
        },
      });
    } catch (error) {
      // ── LA COURSE ────────────────────────────────────────────────────────────
      // Entre la lecture ci-dessus et cette insertion, il reste une fenêtre — et
      // un connecteur qui pousse son lot en parallèle (le cas d'Odoo, qui ouvre
      // plusieurs connexions) vient frapper exactement celle-là. La contrainte
      // @@unique([organizationId, clientUniqueId]) est ce qui la ferme : la
      // perdante ne crée rien et arrive ici.
      //
      // isUniqueConstraintViolation, et non une comparaison sur meta.target :
      // SOUS RLS FORCÉE, PRISMA NE PEUT PAS NOMMER LA COLONNE. Postgres supprime
      // le DETAIL « Key (...) already exists » quand le rôle courant n'a pas le
      // droit de voir la ligne en conflit, et Prisma en dérive target — privé de
      // lui, il rend target: null. Exiger un tableau ferait retomber ce 200
      // idempotent en 500 opaque en production, alors que tous les tests
      // unitaires passeraient (ils fabriquent l'erreur AVEC son target). Voir le
      // commentaire de prisma-errors.ts, qui documente la mesure du 2026-09-07.
      if (!isUniqueConstraintViolation(error, "client_unique_id")) {
        throw error;
      }

      // La relecture ne peut pas revenir vide : la contrainte violée est la seule
      // que cette insertion puisse heurter (invoiceId est nul à ce stade, l'id
      // est un uuid), donc la ligne en conflit appartient à CETTE organisation et
      // reste visible sous le même scope. Si elle revient quand même vide, on
      // relaie l'erreur d'origine plutôt que d'inventer une réponse : mieux vaut
      // un 500 lisible qu'un accusé de réception mensonger sur une pièce fiscale.
      const concurrente = await scoped.pdpRawTransaction.findFirst({
        where: { organizationId: client.organizationId, clientUniqueId: dto.clientUniqueId },
      });
      if (!concurrente) {
        throw error;
      }
      return this.surRejeu(concurrente, "collision");
    }

    this.ingested.inc({ flow });

    // ── 3. Aiguillage ─────────────────────────────────────────────────────────
    // APRÈS le commit, jamais dedans — même raison qu'EtaxInvoiceService : Redis
    // ne participe pas au commit Postgres, un job enfilé à l'intérieur d'une
    // transaction annulée survivrait à son annulation et ferait certifier un
    // document qui n'existe pas.
    //
    // Rien à enfiler pour l'e-reporting : ses lignes attendent en `pending` que
    // le cron les compile en Z de caisse. C'est l'agrégation qui est due à la
    // DGI, pas une transmission par micro-vente.
    if (flow === "e_invoicing") {
      await this.enfiler(ligne);
    }

    return this.decrire(ligne, "accepted");
  }

  // ── Rejeu ─────────────────────────────────────────────────────────────────
  //
  // Détecté par lecture ou par collision, le traitement est le même : on ne crée
  // rien, on rend l'état existant. Avec UNE reprise, qui n'est pas cosmétique.
  private async surRejeu(
    ligne: LigneTampon,
    detection: "lecture" | "collision",
  ): Promise<PdpIngestionResult> {
    this.duplicates.inc({ flow: ligne.flow, detection });

    // RATTRAPAGE D'UN ENFILEMENT PERDU. enfiler() n'échoue jamais bruyamment
    // (Redis éteint ne doit pas transformer un dépôt réussi en erreur pour le
    // connecteur) : une ligne e-invoicing peut donc être en base, acquittée
    // auprès de l'ERP, sans qu'aucun job n'existe. Sans cette reprise, le rejeu
    // du connecteur — sa seule réaction naturelle — se contenterait de lui
    // confirmer un `pending` éternel, et le document ne serait JAMAIS certifié.
    //
    // Sans risque de double traitement : BullMQ dédoublonne sur le jobId
    // déterministe (buildPdpJobId), et un `pending` en base signifie précisément
    // qu'aucun worker n'a mené le travail à son terme — c'est lui qui écrit
    // `certified`.
    if (ligne.flow === "e_invoicing" && ligne.status === "pending") {
      await this.enfiler(ligne);
    }

    return this.decrire(ligne, "duplicate");
  }

  // ── Enfilement ────────────────────────────────────────────────────────────
  //
  // NE LÈVE JAMAIS, comme EtaxInvoiceService.enqueueForInvoice(). Le document est
  // déjà committé : Redis éteint ne doit pas transformer un dépôt réussi en 500
  // pour le connecteur, qui rejouerait alors un document déjà en base. L'échec
  // est compté et journalisé, et la ligne reste en `pending` — c'est exactement
  // la trace qui permet le rattrapage (et que le rejeu du connecteur reprend
  // tout seul, voir surRejeu ci-dessus).
  private async enfiler(ligne: LigneTampon): Promise<void> {
    const payload: PdpInvoicingJobPayload = {
      rawTransactionId: ligne.id,
      organizationId: ligne.organizationId,
      clientUniqueId: ligne.clientUniqueId,
    };

    try {
      await this.queue.add(ETAX_INVOICING_UNITARY, payload, {
        ...PDP_JOB_OPTIONS,
        jobId: buildPdpJobId(ligne.id),
      });
      this.logger.log(
        `Document PDP ${ligne.clientUniqueId} (organisation ${ligne.organizationId}) enfilé pour certification unitaire`,
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.enqueueFailures.inc();
      this.logger.error(
        `Échec d'enfilement du document PDP ${ligne.clientUniqueId} (organisation ${ligne.organizationId}) — la ligne reste en attente, à reprendre au rattrapage ou au prochain rejeu du connecteur`,
        err.stack ?? err.message,
      );
    }
  }

  private async decrire(ligne: LigneTampon, outcome: "accepted" | "duplicate"): Promise<PdpIngestionResult> {
    return {
      outcome,
      transactionId: ligne.id,
      clientUniqueId: ligne.clientUniqueId,
      flow: ligne.flow,
      status: ligne.status,
      receipt: await this.buildReceipt(ligne),
    };
  }

  // Le reçu n'existe QUE pour un document réellement certifié. Les deux
  // conditions sont vérifiées, et non une seule : un `certified` sans
  // certificationId serait une incohérence de base, et rendre un reçu sans
  // identifiant vérifiable serait pire que ne rien rendre — l'ERP l'imprimerait
  // sur un ticket qu'aucun contrôleur ne pourrait valider.
  private async buildReceipt(ligne: LigneTampon): Promise<PdpReceipt | null> {
    if (ligne.status !== "certified" || ligne.certificationId === null) {
      return null;
    }

    return {
      certificationId: ligne.certificationId,
      invoiceId: ligne.invoiceId,
      verificationUrl: verificationUrl(ligne.certificationId),
      qrCode: await buildVerificationQrDataUrl(ligne.certificationId),
    };
  }
}
