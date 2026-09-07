import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { UnrecoverableError, type Queue } from "bullmq";
import type { Counter } from "prom-client";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { EtaxClient } from "./etax.client";
import {
  ETAX_ENQUEUE_FAILURES_METRIC,
  ETAX_FAILURES_METRIC,
  ETAX_SUBMITTED_METRIC,
} from "./etax.metrics";
import { ETAX_JOB_OPTIONS, ETAX_QUEUE, ETAX_SYNC_JOB, etaxEnabled } from "./etax.constants";
import { buildEtaxDeclaration, type EtaxDeclarationPayload, type FiscalPeriodClosingLike } from "./etax-declaration";

// RLS (ADR-111) — CARTE DU MODULE. Les deux chemins sont SCOPÉS, sans exception :
// contrairement à devices.enroll() ou au webhook APIP, rien ici n'est une
// découverte. L'organisation est toujours connue d'avance — elle vient de la
// clôture qu'on vient d'écrire (enqueue) ou du payload du job (worker).
//
// C'est le point à ne pas rater côté worker : un job BullMQ n'a NI session, NI
// RolesGuard, NI requête HTTP. Rien ne pose de scope pour lui. Sans
// organizationScopedClient explicite, le worker lirait la table entière avec les
// GUC dormants — et une erreur de payload lui ferait déclarer à la DGI les
// montants d'une AUTRE PME sous le numéro eTax de la première.
@Injectable()
export class EtaxSyncService {
  private readonly logger = new Logger(EtaxSyncService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @InjectQueue(ETAX_QUEUE) private readonly queue: Queue,
    private readonly client: EtaxClient,
    @InjectMetric(ETAX_SUBMITTED_METRIC) private readonly submitted: Counter<string>,
    @InjectMetric(ETAX_FAILURES_METRIC) private readonly failures: Counter<string>,
    @InjectMetric(ETAX_ENQUEUE_FAILURES_METRIC) private readonly enqueueFailures: Counter<string>,
  ) {}

  // ── Enfilement, appelé à la fin de FiscalPeriodsService.close() ────────────
  //
  // NE LÈVE JAMAIS. Une clôture d'exercice est un acte comptable engageant
  // (sceau OHADA, ADR-110) : elle ne doit pas échouer parce que Redis est
  // éteint. L'échec est donc absorbé, compté et journalisé — et la clôture
  // reste en base avec etax_submitted_at NULL, ce qui est exactement la trace
  // qui permettra de la rattraper.
  async enqueueForClosing(closing: FiscalPeriodClosingLike): Promise<void> {
    if (!etaxEnabled()) {
      this.logger.warn(
        `Télétransmission eTax désactivée (ETAX_ENABLED != "true") — exercice ${closing.year} de l'organisation ${closing.organizationId} non déclaré`,
      );
      return;
    }

    try {
      const payload = await this.buildPayload(closing);
      await this.queue.add(ETAX_SYNC_JOB, payload, {
        ...ETAX_JOB_OPTIONS,
        // jobId déterministe : si close() était rejoué (retry client, double
        // clic), BullMQ dédoublonne au lieu d'empiler deux déclarations pour le
        // même exercice.
        jobId: `${closing.organizationId}:${closing.year}`,
      });
      this.logger.log(`Déclaration eTax enfilée — exercice ${closing.year}, organisation ${closing.organizationId}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.enqueueFailures.inc();
      this.logger.error(
        `Échec d'enfilement de la déclaration eTax (exercice ${closing.year}, organisation ${closing.organizationId}) — la clôture reste valide, la déclaration devra être rattrapée`,
        err.stack ?? err.message,
      );
    }
  }

  // ── Traitement d'un job ───────────────────────────────────────────────────
  //
  // LÈVE en cas d'échec transitoire : c'est l'exception qui fait rejouer le job
  // selon le backoff exponentiel. Les échecs DÉFINITIFS (clôture disparue,
  // organisation sans numéro eTax, sceau divergent) lèvent une
  // UnrecoverableError, qui arrête BullMQ immédiatement — s'acharner 5 fois sur
  // une erreur qui ne se répare pas toute seule ne fait que retarder l'alerte.
  async processDeclaration(job: EtaxDeclarationPayload): Promise<{ submissionRef: string; skipped: boolean }> {
    const scoped = organizationScopedClient(this.prisma, job.organizationId);

    // Double clause, et findFirst — jamais findUnique via un client scopé.
    const closing = await scoped.fiscalPeriodClosing.findFirst({
      where: { id: job.fiscalPeriodId, organizationId: job.organizationId },
    });
    if (!closing) {
      this.failures.inc({ reason: "closing_absent" });
      throw new UnrecoverableError(
        `Clôture ${job.fiscalPeriodId} introuvable pour l'organisation ${job.organizationId}`,
      );
    }

    // Idempotence : eTax a déjà acquitté. Un réessai après un acquittement dont
    // la réponse s'est perdue ne doit PAS redéclarer — une déclaration fiscale
    // transmise ne se retire pas.
    if (closing.etaxSubmittedAt) {
      this.logger.log(
        `Exercice ${closing.year} de l'organisation ${job.organizationId} déjà déclaré le ${closing.etaxSubmittedAt.toISOString()} — envoi ignoré`,
      );
      return { submissionRef: closing.etaxSubmissionRef ?? "", skipped: true };
    }

    // Le sceau du job doit correspondre à celui en base. Une divergence signifie
    // que le job rejoué ne décrit plus la clôture qu'il prétend décrire — on
    // n'envoie pas des montants périmés à la DGI.
    if (closing.sealHash !== job.sealHash) {
      this.failures.inc({ reason: "seal_mismatch" });
      throw new UnrecoverableError(
        `Sceau divergent pour l'exercice ${closing.year} de l'organisation ${job.organizationId} — job périmé`,
      );
    }

    // Le payload transmis est reconstruit depuis la BASE, jamais recopié depuis
    // le job : la base est la source de vérité, le job n'est qu'un déclencheur.
    let payload: EtaxDeclarationPayload;
    try {
      payload = await this.buildPayload(closing);
    } catch (error) {
      this.failures.inc({ reason: "payload_invalide" });
      throw new UnrecoverableError((error as Error).message);
    }

    let submissionRef: string;
    try {
      ({ submissionRef } = await this.client.submit(payload));
    } catch (error) {
      // Transitoire par défaut (eTax en maintenance, réseau) : on relaie tel
      // quel pour que le backoff exponentiel reprenne la main.
      this.failures.inc({ reason: "transmission" });
      throw error;
    }

    await scoped.fiscalPeriodClosing.update({
      where: { id: closing.id },
      data: { etaxSubmittedAt: new Date(), etaxSubmissionRef: submissionRef },
    });

    this.submitted.inc();
    this.logger.log(
      `Exercice ${closing.year} de l'organisation ${job.organizationId} déclaré à eTax (réf. ${submissionRef})`,
    );
    return { submissionRef, skipped: false };
  }

  // Lecture SCOPÉE de l'organisation : etaxNumber et regimeFiscal sont les deux
  // seules données hors clôture qui entrent dans la déclaration.
  private async buildPayload(closing: FiscalPeriodClosingLike): Promise<EtaxDeclarationPayload> {
    const scoped = organizationScopedClient(this.prisma, closing.organizationId);
    const organization = await scoped.organization.findFirst({
      where: { id: closing.organizationId },
      select: { etaxNumber: true, regimeFiscal: true },
    });
    if (!organization) {
      throw new Error(`Organisation ${closing.organizationId} introuvable`);
    }
    return buildEtaxDeclaration(closing, organization);
  }
}
