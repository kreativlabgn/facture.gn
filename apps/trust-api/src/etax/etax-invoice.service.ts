import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { UnrecoverableError, type Queue } from "bullmq";
import type { Counter } from "prom-client";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { EtaxClient, EtaxRejetDefinitif } from "./etax.client";
import { ETAX_INVOICE_JOB, ETAX_JOB_OPTIONS, ETAX_QUEUE, etaxEnabled } from "./etax.constants";
import {
  ETAX_ENQUEUE_FAILURES_METRIC,
  ETAX_INVOICE_FAILURES_METRIC,
  ETAX_INVOICES_TRANSMITTED_METRIC,
} from "./etax.metrics";
import { buildEtaxInvoice, type EtaxInvoicePayload } from "./etax-invoice";

// Transmission unitaire des factures au guichet e-TVA (LFI 2025).
//
// RLS (ADR-111) — CARTE DU MODULE. Les deux chemins sont SCOPÉS, sans exception,
// pour la même raison qu'EtaxSyncService : rien ici n'est une découverte, et
// l'organisation est toujours connue d'avance — elle vient de la facture qu'on
// vient d'émettre, ou du payload du job.
//
// Le piège du worker vaut d'être redit : un job BullMQ n'a NI session, NI
// RolesGuard, NI requête HTTP. Rien ne pose de scope pour lui. Sans
// setOrganizationScope explicite, il écrirait avec les GUC dormants — et un
// payload fautif ferait déclarer à la DGI les montants d'une PME sous le numéro
// eTax d'une autre.
@Injectable()
export class EtaxInvoiceService {
  private readonly logger = new Logger(EtaxInvoiceService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @InjectQueue(ETAX_QUEUE) private readonly queue: Queue,
    private readonly client: EtaxClient,
    @InjectMetric(ETAX_INVOICES_TRANSMITTED_METRIC) private readonly transmitted: Counter<string>,
    @InjectMetric(ETAX_INVOICE_FAILURES_METRIC) private readonly failures: Counter<string>,
    @InjectMetric(ETAX_ENQUEUE_FAILURES_METRIC) private readonly enqueueFailures: Counter<string>,
  ) {}

  // ── Enfilement, appelé par InvoicesService.issue() ────────────────────────
  //
  // APRÈS LE COMMIT, JAMAIS DEDANS. C'est le point central de cette méthode.
  // issue() a plusieurs chemins de rollback bien réels — collision de numéro,
  // collision d'identifiant de certification, expiration du verrou (P2028). Un
  // job enfilé à l'intérieur de la transaction survivrait à son annulation :
  // Redis ne participe pas au commit Postgres. On aurait alors déclaré à la DGI
  // une facture qui n'existe pas — et une transmission fiscale ne se retire pas.
  //
  // NE LÈVE JAMAIS, pour la même raison qu'enqueueForClosing : la facture est
  // déjà certifiée et committée. Redis éteint ne doit pas transformer une
  // émission réussie en erreur pour le commerçant, qui a son document en main.
  // L'échec est compté et journalisé, et la facture reste avec etax_status NULL
  // — la trace exacte qui permettra de la rattraper.
  async enqueueForInvoice(invoiceId: string, organizationId: string): Promise<void> {
    if (!etaxEnabled()) {
      // debug et non warn : contrairement à une clôture d'exercice (quelques-unes
      // par an), on émet des milliers de factures par jour. Un avertissement par
      // facture noierait le journal en développement, où cette configuration est
      // la normale.
      this.logger.debug(
        `Télétransmission e-TVA désactivée (ETAX_ENABLED != "true") — facture ${invoiceId} non transmise`,
      );
      return;
    }

    try {
      const payload = await this.buildPayload(invoiceId, organizationId);

      // L'ordre compte : on marque `pending` AVANT d'enfiler. Enfiler d'abord
      // laisserait une fenêtre où le worker traite la facture et écrit
      // `transmitted`, avant que ce marquage-ci ne l'écrase en `pending` — une
      // facture bel et bien transmise qui se présenterait comme en attente pour
      // toujours.
      await organizationScopedClient(this.prisma, organizationId).invoice.update({
        where: { id: invoiceId },
        data: { etaxStatus: "pending" },
      });

      await this.queue.add(ETAX_INVOICE_JOB, payload, {
        ...ETAX_JOB_OPTIONS,
        // jobId déterministe : un double clic sur « Émettre », ou un rejeu
        // client, ne produit pas deux transmissions de la même facture. Tiret et
        // non deux-points — BullMQ réserve « : » pour ses clés Redis et rejette
        // tout jobId qui en contient.
        jobId: `invoice-${invoiceId}`,
      });
      this.logger.log(`Facture ${invoiceId} enfilée pour transmission e-TVA`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.enqueueFailures.inc();
      this.logger.error(
        `Échec d'enfilement de la facture ${invoiceId} — la facture reste émise et certifiée, la transmission devra être rattrapée`,
        err.stack ?? err.message,
      );
      // On défait le marquage : `pending` doit signifier « un job existe ».
      // Laissé tel quel, il présenterait indéfiniment comme « en attente de la
      // DGI » une facture que plus rien ne viendra transmettre — et le
      // rattrapage, qui cherche les factures hors périmètre, passerait à côté.
      await this.annulerMarquage(invoiceId, organizationId);
    }
  }

  /** Remet etax_status à NULL après un enfilement manqué. Meilleur effort : on
   *  est déjà dans un chemin d'erreur, une seconde panne ne doit pas la masquer. */
  private async annulerMarquage(invoiceId: string, organizationId: string): Promise<void> {
    try {
      await organizationScopedClient(this.prisma, organizationId).invoice.update({
        where: { id: invoiceId },
        data: { etaxStatus: null },
      });
    } catch {
      this.logger.warn(
        `Facture ${invoiceId} laissée en attente sans job — à reprendre au rattrapage`,
      );
    }
  }

  // ── Traitement du job ────────────────────────────────────────────────────
  //
  // LÈVE À DESSEIN en cas d'échec : c'est l'exception qui déclenche le backoff
  // exponentiel de BullMQ. L'avaler marquerait le job « completed » alors que la
  // DGI n'a rien reçu.
  async processTransmission(
    payload: EtaxInvoicePayload,
  ): Promise<{ receiptNumber: string; skipped: boolean }> {
    const scoped = organizationScopedClient(this.prisma, payload.organizationId);

    // Idempotence : un acquittement peut avoir été enregistré puis le job rejoué
    // (redémarrage du worker entre l'écriture et l'ack Redis). On ne retransmet
    // pas — la DGI a déjà le reçu, et rien ne dit qu'elle dédoublonnerait un
    // second envoi.
    const existante = await scoped.invoice.findFirst({
      where: { id: payload.invoiceId, organizationId: payload.organizationId },
      select: { etaxStatus: true, etaxReceiptNumber: true },
    });
    if (existante?.etaxStatus === "transmitted" && existante.etaxReceiptNumber) {
      this.logger.log(`Facture ${payload.invoiceId} déjà transmise — job ignoré`);
      return { receiptNumber: existante.etaxReceiptNumber, skipped: true };
    }

    let receiptNumber: string;
    try {
      const { submissionRef } = await this.client.submitInvoice(payload);
      receiptNumber = submissionRef;
    } catch (error) {
      // Refus définitif : rejouer à l'identique donnera le même refus. On marque
      // l'échec tout de suite et on coupe le backoff — s'acharner bloquerait la
      // file derrière des milliers de factures par jour.
      if (error instanceof EtaxRejetDefinitif) {
        await this.marquerEchec(payload, `rejet définitif (${error.status})`);
        this.failures.inc({ reason: "rejet_definitif" });
        throw new UnrecoverableError(
          `Facture ${payload.invoiceId} rejetée définitivement par eTax (${error.status})`,
        );
      }
      // Panne passagère : on laisse BullMQ rejouer. AUCUN marquage ici — écrire
      // `failed` dès la première tentative afficherait au commerçant un échec que
      // les quatre suivantes vont peut-être démentir.
      this.failures.inc({ reason: "transitoire" });
      throw error;
    }

    await this.prisma.$transaction(async (tx) => {
      await setOrganizationScope(tx, payload.organizationId);
      await tx.invoice.update({
        where: { id: payload.invoiceId },
        data: {
          etaxStatus: "transmitted",
          etaxReceiptNumber: receiptNumber,
          etaxTransmittedAt: new Date(),
        },
      });
      await tx.invoiceEvent.create({
        data: {
          invoiceId: payload.invoiceId,
          type: "etax_transmitted",
          // actorId NULL : personne n'a agi, c'est un worker. Inventer un acteur
          // système dans le journal WORM rendrait l'audit menteur.
          metadata: { receiptNumber },
        },
      });
    });

    this.transmitted.inc();
    this.logger.log(`Facture ${payload.invoiceId} transmise — reçu ${receiptNumber}`);
    return { receiptNumber, skipped: false };
  }

  /** Marque l'échec définitif. NE LÈVE JAMAIS : l'appelant a déjà une erreur à
   *  remonter, et la masquer par une panne d'écriture ferait perdre la cause. */
  async marquerEchec(payload: EtaxInvoicePayload, cause: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await setOrganizationScope(tx, payload.organizationId);
        await tx.invoice.update({
          where: { id: payload.invoiceId },
          data: { etaxStatus: "failed" },
        });
        await tx.invoiceEvent.create({
          data: {
            invoiceId: payload.invoiceId,
            type: "etax_transmission_failed",
            // La CAUSE, jamais le corps de la réponse du guichet : il contient
            // l'écho du payload, donc le numéro eTax et les montants — et ce
            // journal-ci est lisible par le commerçant.
            metadata: { cause },
          },
        });
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Impossible de marquer l'échec de transmission de la facture ${payload.invoiceId}`,
        err.stack ?? err.message,
      );
    }
  }

  // Lecture SCOPÉE : l'organisation vient de l'appelant, qui vient d'émettre la
  // facture. findFirst et jamais findUnique* — invariant du dépôt pour tout
  // client scopé.
  private async buildPayload(invoiceId: string, organizationId: string): Promise<EtaxInvoicePayload> {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const invoice = await scoped.invoice.findFirstOrThrow({
      where: { id: invoiceId, organizationId },
      select: {
        id: true,
        organizationId: true,
        number: true,
        certificationId: true,
        hash: true,
        totalHt: true,
        totalTva: true,
        totalTtc: true,
        issuedAt: true,
        // `select` explicite plutôt qu'un include : un include embarquerait tout
        // le client — dont son téléphone — dans un payload qui part chez la DGI.
        customer: { select: { nif: true } },
      },
    });
    const organization = await scoped.organization.findFirstOrThrow({
      where: { id: organizationId },
      select: { etaxNumber: true, regimeFiscal: true },
    });

    return buildEtaxInvoice(invoice, organization, invoice.customer);
  }
}
